package tagrename

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/usememos/memos/internal/httphandler"
)

// The user's own order of tags (for the sidebar, the tag filter and tag management): a list of
// full tag paths. Tags not listed follow, by use. Kept in a fork table created with IF NOT
// EXISTS, outside the upstream migrations.
const orderSchema = `
CREATE TABLE IF NOT EXISTS tag_order (
  user_id INTEGER PRIMARY KEY,
  tags TEXT NOT NULL,
  updated_ts BIGINT NOT NULL
);
`

// maxOrderedTags bounds what one user may store.
const maxOrderedTags = 5000

func (s *Service) prepareOrder(ctx context.Context) {
	if _, err := s.db.ExecContext(ctx, orderSchema); err != nil {
		slog.Warn("tag order disabled: failed to prepare table", slog.String("error", err.Error()))
		return
	}
	s.orderEnabled = true
}

func (s *Service) loadOrder(ctx context.Context, userID int32) ([]string, error) {
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT tags FROM tag_order WHERE user_id = ?", userID).Scan(&raw)
	if err == sql.ErrNoRows {
		return []string{}, nil
	}
	if err != nil {
		return nil, err
	}
	tags := []string{}
	if err := json.Unmarshal([]byte(raw), &tags); err != nil {
		return []string{}, nil
	}
	return tags, nil
}

func (s *Service) saveOrder(ctx context.Context, userID int32, tags []string) error {
	raw, err := json.Marshal(tags)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx,
		`INSERT INTO tag_order (user_id, tags, updated_ts) VALUES (?, ?, ?)
		 ON CONFLICT(user_id) DO UPDATE SET tags = excluded.tags, updated_ts = excluded.updated_ts`,
		userID, string(raw), time.Now().Unix())
	return err
}

// renameInOrder moves `from` and the tags under it to `to` in the saved order; an empty `to`
// drops them.
func (s *Service) renameInOrder(ctx context.Context, userID int32, from, to string) error {
	if !s.orderEnabled {
		return nil
	}
	tags, err := s.loadOrder(ctx, userID)
	if err != nil || len(tags) == 0 {
		return err
	}
	seen := map[string]bool{}
	next := make([]string, 0, len(tags))
	for _, tag := range tags {
		if tag == from || strings.HasPrefix(tag, from+"/") {
			if to == "" {
				continue
			}
			tag = to + tag[len(from):]
		}
		if !seen[tag] {
			seen[tag] = true
			next = append(next, tag)
		}
	}
	return s.saveOrder(ctx, userID, next)
}

// getOrder answers {tags: [...]} in the caller's order.
func (s *Service) getOrder(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	if !s.orderEnabled {
		return &httphandler.Error{Code: http.StatusNotImplemented, Message: "tag order is not available"}
	}
	tags, err := s.loadOrder(r.Context(), user.ID)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to load the tag order", Cause: err}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return httphandler.JSON(w, http.StatusOK, map[string]any{"tags": tags})
}

// setOrder replaces the caller's order with {tags: [...]}.
func (s *Service) setOrder(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	if !s.orderEnabled {
		return &httphandler.Error{Code: http.StatusNotImplemented, Message: "tag order is not available"}
	}
	var body struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 512<<10)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	if len(body.Tags) > maxOrderedTags {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "too many tags"}
	}
	seen := map[string]bool{}
	tags := make([]string, 0, len(body.Tags))
	for _, tag := range body.Tags {
		tag = normalize(tag)
		if tag == "" || len(tag) > 256 || seen[tag] {
			continue
		}
		seen[tag] = true
		tags = append(tags, tag)
	}
	if err := s.saveOrder(r.Context(), user.ID, tags); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the tag order", Cause: err}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return httphandler.JSON(w, http.StatusOK, map[string]any{"tags": tags})
}
