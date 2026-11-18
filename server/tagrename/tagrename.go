// Package tagrename renames one of the current user's tags, together with the tags under it,
// across all of their memos: POST /api/x/tags/rename {from, to}. Each changed memo is saved
// through the regular memo update, so its tags, versions and live updates follow as for any
// edit. Tag display rules (colors) keyed by the old name move to the new one.
//
// Fork-only, kept in its own package so upstream updates merge cleanly.
package tagrename

import (
	"context"
	"encoding/json"
	"maps"
	"net/http"
	"slices"
	"strings"
	"unicode"

	"google.golang.org/protobuf/types/known/fieldmaskpb"

	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/markdown"
	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/api"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// Service serves the tag rename endpoint.
type Service struct {
	store         *store.Store
	authenticator *auth.Authenticator
	markdown      markdown.Service
	api           *api.APIService
}

// New builds the service; changed memos are saved through apiService.
func New(s *store.Store, secret string, apiService *api.APIService) *Service {
	return &Service{
		store:         s,
		authenticator: auth.NewAuthenticator(s, secret),
		markdown:      markdown.NewService(markdown.WithTagExtension()),
		api:           apiService,
	}
}

// RegisterRoutes serves POST /api/x/tags/rename.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("POST /api/x/tags/rename", httphandler.Func(s.rename))
}

// normalize trims the tag and drops a leading '#'.
func normalize(tag string) string {
	return strings.TrimPrefix(strings.TrimSpace(tag), "#")
}

// validTag reports whether `#tag` reads back as exactly that tag.
func (s *Service) validTag(tag string) bool {
	if tag == "" || strings.IndexFunc(tag, unicode.IsSpace) >= 0 || strings.HasPrefix(tag, "/") || strings.HasSuffix(tag, "/") {
		return false
	}
	tags, err := s.markdown.ExtractTags([]byte("#" + tag))
	return err == nil && slices.Contains(tags, tag)
}

func hasTagTree(tags []string, from string) bool {
	return slices.ContainsFunc(tags, func(tag string) bool { return tag == from || strings.HasPrefix(tag, from+"/") })
}

func (s *Service) rename(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	user, err := s.authenticator.AuthenticateToUser(ctx, r.Header.Get("Authorization"), r.Header.Get("Cookie"))
	if err != nil || user == nil {
		return &httphandler.Error{Code: http.StatusUnauthorized, Message: "authentication required"}
	}
	var body struct {
		From string `json:"from"`
		To   string `json:"to"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	from, to := normalize(body.From), normalize(body.To)
	if from == "" || !s.validTag(to) {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid tag name"}
	}
	if from == to {
		return httphandler.JSON(w, http.StatusOK, map[string]any{"updated": []string{}})
	}

	memos, err := s.store.ListMemos(ctx, &store.FindMemo{CreatorID: &user.ID})
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list memos", Cause: err}
	}
	updated := []string{}
	for _, memo := range memos {
		if memo.Payload == nil || !hasTagTree(memo.Payload.Tags, from) {
			continue
		}
		content, changed, err := markdown.RenameTagTree([]byte(memo.Content), from, to)
		if err != nil {
			return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to rename tag", Cause: err}
		}
		if !changed {
			continue
		}
		name := "memos/" + memo.UID
		if err := s.updateContent(ctx, user, name, content); err != nil {
			return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to update memo " + name, Cause: err}
		}
		updated = append(updated, name)
	}
	if err := s.renameTagSettings(ctx, user.ID, from, to); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to move tag settings", Cause: err}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return httphandler.JSON(w, http.StatusOK, map[string]any{"updated": updated})
}

// updateContent saves a memo's new content as the user, like an edit from the app would.
func (s *Service) updateContent(ctx context.Context, user *store.User, memoName, content string) error {
	_, err := s.api.UpdateMemo(auth.SetUserInContext(ctx, user, ""), &apipb.UpdateMemoRequest{
		Memo:       &apipb.Memo{Name: memoName, Content: content},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	return err
}

// renameTagSettings moves display rules written for the old tag (or under it) to the new name.
// Rules are patterns; only keys that spell the tag literally move.
func (s *Service) renameTagSettings(ctx context.Context, userID int32, from, to string) error {
	setting, err := s.store.GetUserSetting(ctx, &store.FindUserSetting{UserID: &userID, Key: storepb.UserSetting_TAGS})
	if err != nil || setting == nil || setting.GetTags() == nil {
		return err
	}
	// A copy: the setting may be the store cache's own value.
	tags := maps.Clone(setting.GetTags().GetTags())
	moved := map[string]*storepb.UserTagMetadata{}
	for key, metadata := range tags {
		if key == from || strings.HasPrefix(key, from+"/") {
			moved[to+key[len(from):]] = metadata
			delete(tags, key)
		}
	}
	if len(moved) == 0 {
		return nil
	}
	for key, metadata := range moved {
		if _, exists := tags[key]; !exists {
			tags[key] = metadata
		}
	}
	_, err = s.store.UpsertUserSetting(ctx, &storepb.UserSetting{
		UserId: userID,
		Key:    storepb.UserSetting_TAGS,
		Value:  &storepb.UserSetting_Tags{Tags: &storepb.TagsUserSetting{Tags: tags}},
	})
	return err
}
