package test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/server/starred"
)

func TestStarredMemosListsOnlyTheViewersStars(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	mux := http.NewServeMux()
	starred.New(ts.Store, ts.Secret).RegisterRoutes(mux)

	owner, err := ts.CreateRegularUser(ctx, "starred-owner")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	create := func(content string) *apipb.Memo {
		memo, err := ts.Service.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: content, Visibility: apipb.Visibility_PRIVATE}})
		require.NoError(t, err)
		return memo
	}
	starredMemo, likedMemo, _ := create("starred"), create("liked"), create("plain")
	for memo, reaction := range map[*apipb.Memo]string{starredMemo: starred.Reaction, likedMemo: "👍"} {
		_, err := ts.Service.UpsertMemoReaction(ownerCtx, &apipb.UpsertMemoReactionRequest{Parent: memo.Name, Reaction: &apipb.Reaction{ReactionType: reaction}})
		require.NoError(t, err)
	}

	token, err := ts.Service.CreatePersonalAccessToken(ownerCtx, &apipb.CreatePersonalAccessTokenRequest{Parent: "users/" + owner.Username, Description: "starred"})
	require.NoError(t, err)
	request := httptest.NewRequest(http.MethodGet, "/api/x/memos/starred", nil)
	request.Header.Set("Authorization", "Bearer "+token.Token)
	recorder := httptest.NewRecorder()
	mux.ServeHTTP(recorder, request)
	require.Equal(t, http.StatusOK, recorder.Code, recorder.Body.String())
	var body struct {
		UIDs []string `json:"uids"`
	}
	require.NoError(t, json.Unmarshal(recorder.Body.Bytes(), &body))
	require.Equal(t, []string{strings.TrimPrefix(starredMemo.Name, "memos/")}, body.UIDs)

	// The sidebar's Starred view lists them through the memo filter.
	listed, err := ts.Service.ListMemos(ownerCtx, &apipb.ListMemosRequest{Filter: `uid in ["` + body.UIDs[0] + `"]`})
	require.NoError(t, err)
	require.Len(t, listed.Memos, 1)
	require.Equal(t, starredMemo.Name, listed.Memos[0].Name)
	none, err := ts.Service.ListMemos(ownerCtx, &apipb.ListMemosRequest{Filter: `uid in []`})
	require.NoError(t, err)
	require.Empty(t, none.Memos)

	anonymous := httptest.NewRecorder()
	mux.ServeHTTP(anonymous, httptest.NewRequest(http.MethodGet, "/api/x/memos/starred", nil))
	require.Equal(t, http.StatusUnauthorized, anonymous.Code)
}
