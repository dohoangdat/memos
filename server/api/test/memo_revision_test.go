package test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/server/api"
	"github.com/usememos/memos/server/revision"
)

func TestMemoRevisionsRecordListAndAccess(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	revisions := revision.New(ctx, ts.Profile, ts.Store, ts.Secret)
	previous := api.MemoRevisionRecorder
	api.MemoRevisionRecorder = revisions.Record
	t.Cleanup(func() { api.MemoRevisionRecorder = previous })
	mux := http.NewServeMux()
	revisions.RegisterRoutes(mux)

	owner, err := ts.CreateRegularUser(ctx, "revision-owner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "revision-other")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)

	memo, err := ts.Service.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: "v1", Visibility: apipb.Visibility_PRIVATE}})
	require.NoError(t, err)
	update := func(content string, paths ...string) {
		_, err := ts.Service.UpdateMemo(ownerCtx, &apipb.UpdateMemoRequest{
			Memo:       &apipb.Memo{Name: memo.Name, Content: content, Pinned: true},
			UpdateMask: &fieldmaskpb.FieldMask{Paths: paths},
		})
		require.NoError(t, err)
	}
	update("v2", "content")
	update("v2", "content") // unchanged content records nothing
	update("v3", "content")
	update("v3", "pinned") // other fields record nothing

	uid := strings.TrimPrefix(memo.Name, "memos/")
	list, err := revisions.List(ctx, uid)
	require.NoError(t, err)
	require.Len(t, list, 2)
	require.Equal(t, "v2", list[0].Content, "newest first")
	require.Equal(t, "v1", list[1].Content)

	for i := 4; i < 4+revision.KeepPerMemo+3; i++ {
		update(fmt.Sprintf("v%d", i), "content")
	}
	list, err = revisions.List(ctx, uid)
	require.NoError(t, err)
	require.Len(t, list, revision.KeepPerMemo, "older revisions are pruned")

	tokenFor := func(userID int32, username string) string {
		response, err := ts.Service.CreatePersonalAccessToken(ts.CreateUserContext(ctx, userID), &apipb.CreatePersonalAccessTokenRequest{
			Parent: "users/" + username, Description: "revisions",
		})
		require.NoError(t, err)
		return response.Token
	}
	get := func(token string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, "/api/x/memos/"+uid+"/revisions", nil)
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		return recorder
	}

	response := get(tokenFor(owner.ID, owner.Username))
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body struct {
		Revisions []revision.Revision `json:"revisions"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.Len(t, body.Revisions, revision.KeepPerMemo)

	require.Equal(t, http.StatusNotFound, get(tokenFor(other.ID, other.Username)).Code, "someone else's memo is not found")
	require.Equal(t, http.StatusUnauthorized, get("").Code)
}
