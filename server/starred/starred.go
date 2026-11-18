// Package starred serves which memos the current user starred. A star is the
// user's own ⭐ reaction, which the memo filter cannot select, so the sidebar's
// Starred view asks here for the memo uids and filters with `uid in [...]`.
// Fork-only, kept in its own package so upstream updates merge cleanly.
package starred

import (
	"net/http"

	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

// Reaction is the reaction type the web app uses for a star.
const Reaction = "⭐"

// Service serves GET /api/x/memos/starred.
type Service struct {
	store         *store.Store
	authenticator *auth.Authenticator
}

func New(s *store.Store, secret string) *Service {
	return &Service{store: s, authenticator: auth.NewAuthenticator(s, secret)}
}

func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/x/memos/starred", httphandler.Func(s.serveStarred))
}

func (s *Service) serveStarred(w http.ResponseWriter, r *http.Request) error {
	ctx := r.Context()
	// Bearer token only: the refresh cookie also rides on requests from sibling
	// subdomains (same-site under SameSite=Lax), which must not act for the user.
	user, err := s.authenticator.AuthenticateToUser(ctx, r.Header.Get("Authorization"), "")
	if err != nil || user == nil {
		return &httphandler.Error{Code: http.StatusUnauthorized, Message: "authentication required"}
	}
	reactions, err := s.store.ListReactions(ctx, &store.FindReaction{CreatorID: &user.ID})
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list reactions", Cause: err}
	}
	ids := []int32{}
	for _, reaction := range reactions {
		if reaction.ReactionType == Reaction {
			ids = append(ids, reaction.MemoID)
		}
	}
	uids := []string{}
	if len(ids) > 0 {
		memos, err := s.store.ListMemos(ctx, &store.FindMemo{IDList: ids})
		if err != nil {
			return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list memos", Cause: err}
		}
		for _, memo := range memos {
			uids = append(uids, memo.UID)
		}
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return httphandler.JSON(w, http.StatusOK, map[string]any{"uids": uids})
}
