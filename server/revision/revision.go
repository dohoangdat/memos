// Package revision keeps earlier versions of a memo's content so they can be
// listed and restored. It is a fork-only addition kept in its own package and
// table (created with IF NOT EXISTS, outside the upstream migration sequence)
// so upstream updates merge cleanly.
//
// A revision is recorded whenever UpdateMemo changes a memo's content: the
// content it had before the change. Restoring is an ordinary content update
// from the client, which in turn records the content it replaces, so a
// restore can itself be undone.
package revision

import (
	"context"
	"database/sql"
	"log/slog"
	"net/http"
	"time"

	"github.com/pkg/errors"

	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// KeepPerMemo is how many earlier versions are kept per memo; older ones are pruned.
const KeepPerMemo = 20

const schema = `
CREATE TABLE IF NOT EXISTS memo_revision (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  memo_uid TEXT NOT NULL,
  content TEXT NOT NULL,
  created_ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memo_revision_memo_uid ON memo_revision (memo_uid, id);
`

// Revision is one earlier version of a memo's content.
type Revision struct {
	ID         int64  `json:"id"`
	CreateTime string `json:"createTime"`
	Content    string `json:"content"`
	SizeBytes  int    `json:"sizeBytes"`
}

// Service records and serves memo revisions. It is disabled (records nothing,
// answers 501) on drivers other than SQLite.
type Service struct {
	db            *sql.DB
	store         *store.Store
	authenticator *auth.Authenticator
	enabled       bool
	now           func() time.Time
}

// New prepares the revision table. A failure disables the feature instead of
// stopping the server.
func New(ctx context.Context, p *profile.Profile, s *store.Store, secret string) *Service {
	service := &Service{
		db:            s.GetDriver().GetDB(),
		store:         s,
		authenticator: auth.NewAuthenticator(s, secret),
		now:           time.Now,
	}
	if p.Driver != "sqlite" {
		slog.Info("memo revisions are only kept on sqlite; disabled", slog.String("driver", p.Driver))
		return service
	}
	if _, err := service.db.ExecContext(ctx, schema); err != nil {
		slog.Warn("memo revisions disabled: failed to prepare table", slog.String("error", err.Error()))
		return service
	}
	service.enabled = true
	return service
}

// Record keeps `previous`, the content a memo had before an update, and prunes
// that memo's revisions to KeepPerMemo. Best effort: a failure is logged and
// never fails the update.
func (s *Service) Record(ctx context.Context, memoUID, previous string) {
	if !s.enabled {
		return
	}
	if err := s.record(ctx, memoUID, previous); err != nil {
		slog.Warn("failed to record memo revision", slog.String("memo", memoUID), slog.String("error", err.Error()))
	}
}

func (s *Service) record(ctx context.Context, memoUID, previous string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, "INSERT INTO memo_revision (memo_uid, content, created_ts) VALUES (?, ?, ?)", memoUID, previous, s.now().Unix()); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM memo_revision WHERE memo_uid = ? AND id NOT IN (
		   SELECT id FROM memo_revision WHERE memo_uid = ? ORDER BY id DESC LIMIT ?)`,
		memoUID, memoUID, KeepPerMemo); err != nil {
		return err
	}
	return tx.Commit()
}

// List returns a memo's revisions, newest first.
func (s *Service) List(ctx context.Context, memoUID string) ([]Revision, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, content, created_ts FROM memo_revision WHERE memo_uid = ? ORDER BY id DESC LIMIT ?", memoUID, KeepPerMemo)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	revisions := []Revision{}
	for rows.Next() {
		var revision Revision
		var createdTs int64
		if err := rows.Scan(&revision.ID, &revision.Content, &createdTs); err != nil {
			return nil, err
		}
		revision.CreateTime = time.Unix(createdTs, 0).UTC().Format(time.RFC3339)
		revision.SizeBytes = len(revision.Content)
		revisions = append(revisions, revision)
	}
	return revisions, rows.Err()
}

// RegisterRoutes serves GET /api/x/memos/{uid}/revisions to the memo's creator and admins.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/x/memos/{uid}/revisions", httphandler.Func(s.serveRevisions))
}

func (s *Service) serveRevisions(w http.ResponseWriter, r *http.Request) error {
	if !s.enabled {
		return &httphandler.Error{Code: http.StatusNotImplemented, Message: "memo revisions are not available"}
	}
	ctx := r.Context()
	// Bearer token only: the refresh cookie also rides on requests from sibling
	// subdomains (same-site under SameSite=Lax), which must not act for the user.
	user, err := s.authenticator.AuthenticateToUser(ctx, r.Header.Get("Authorization"), "")
	if err != nil || user == nil {
		return &httphandler.Error{Code: http.StatusUnauthorized, Message: "authentication required"}
	}
	uid := r.PathValue("uid")
	memo, err := s.store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to get memo", Cause: err}
	}
	// Earlier versions may hold text the memo no longer shows, so only those who can edit it see them.
	if memo == nil || (memo.CreatorID != user.ID && user.Role != store.RoleAdmin) {
		return &httphandler.Error{Code: http.StatusNotFound, Message: "memo not found"}
	}
	revisions, err := s.List(ctx, uid)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list revisions", Cause: errors.Wrap(err, "list revisions")}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return httphandler.JSON(w, http.StatusOK, map[string]any{"revisions": revisions})
}

// Purge deletes every kept version of a memo. Locking a memo calls it, so no
// earlier plaintext outlives the encryption.
func (s *Service) Purge(ctx context.Context, memoUID string) error {
	if !s.enabled {
		return nil
	}
	_, err := s.db.ExecContext(ctx, "DELETE FROM memo_revision WHERE memo_uid = ?", memoUID)
	return err
}
