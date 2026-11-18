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
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/tagrename"
	"github.com/usememos/memos/store"
)

func TestTagRename(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	mux := http.NewServeMux()
	tagrename.New(ts.Store, ts.Secret, ts.Service).RegisterRoutes(mux)

	owner, err := ts.CreateRegularUser(ctx, "rename-owner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "rename-other")
	require.NoError(t, err)
	ownerCtx, otherCtx := ts.CreateUserContext(ctx, owner.ID), ts.CreateUserContext(ctx, other.ID)
	token, err := ts.Service.CreatePersonalAccessToken(ownerCtx, &apipb.CreatePersonalAccessTokenRequest{Parent: "users/" + owner.Username, Description: "rename"})
	require.NoError(t, err)

	create := func(userCtx context.Context, content string) string {
		memo, err := ts.Service.CreateMemo(userCtx, &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: content, Visibility: apipb.Visibility_PRIVATE}})
		require.NoError(t, err)
		return memo.Name
	}
	tagged := create(ownerCtx, "plan #cong-viec/du-an and `#cong-viec`")
	parent := create(ownerCtx, "#cong-viec today")
	untouched := create(ownerCtx, "#cong-viecs is another tag")
	foreign := create(otherCtx, "#cong-viec of someone else")

	_, err = ts.Store.UpsertUserSetting(ctx, &storepb.UserSetting{UserId: owner.ID, Key: storepb.UserSetting_TAGS,
		Value: &storepb.UserSetting_Tags{Tags: &storepb.TagsUserSetting{Tags: map[string]*storepb.UserTagMetadata{
			"cong-viec": {}, "cong-viec/du-an": {}, "khac": {},
		}}}})
	require.NoError(t, err)

	call := func(token, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodPost, "/api/x/tags/rename", strings.NewReader(body))
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		return recorder
	}
	require.Equal(t, http.StatusUnauthorized, call("", `{"from":"cong-viec","to":"work"}`).Code)
	require.Equal(t, http.StatusBadRequest, call(token.Token, `{"from":"cong-viec","to":"two words"}`).Code)
	require.Equal(t, http.StatusBadRequest, call(token.Token, `{"from":"cong-viec","to":""}`).Code)

	response := call(token.Token, `{"from":"#cong-viec","to":"#work"}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body struct {
		Updated []string `json:"updated"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	require.ElementsMatch(t, []string{tagged, parent}, body.Updated)

	content := func(userCtx context.Context, name string) (string, []string) {
		memo, err := ts.Service.GetMemo(userCtx, &apipb.GetMemoRequest{Name: name})
		require.NoError(t, err)
		return memo.Content, memo.Tags
	}
	text, tags := content(ownerCtx, tagged)
	require.Equal(t, "plan #work/du-an and `#cong-viec`", text, "code keeps its text")
	require.ElementsMatch(t, []string{"work", "work/du-an"}, tags)
	text, _ = content(ownerCtx, parent)
	require.Equal(t, "#work today", text)
	text, _ = content(ownerCtx, untouched)
	require.Equal(t, "#cong-viecs is another tag", text)
	text, _ = content(otherCtx, foreign)
	require.Equal(t, "#cong-viec of someone else", text, "only the caller's memos change")

	setting, err := ts.Store.GetUserSetting(ctx, &store.FindUserSetting{UserID: &owner.ID, Key: storepb.UserSetting_TAGS})
	require.NoError(t, err)
	keys := []string{}
	for key := range setting.GetTags().GetTags() {
		keys = append(keys, key)
	}
	require.ElementsMatch(t, []string{"work", "work/du-an", "khac"}, keys, "tag colors follow the rename")
}
