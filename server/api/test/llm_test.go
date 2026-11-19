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
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/server/llm"
	"github.com/usememos/memos/store"
)

func TestLLMSuggestTags(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	admin, err := ts.CreateHostUser(ctx, "llm-admin")
	require.NoError(t, err)
	member, err := ts.CreateRegularUser(ctx, "llm-member")
	require.NoError(t, err)
	tokenFor := func(user *store.User) string {
		response, err := ts.Service.CreatePersonalAccessToken(ts.CreateUserContext(ctx, user.ID),
			&apipb.CreatePersonalAccessTokenRequest{Parent: "users/" + user.Username, Description: "llm"})
		require.NoError(t, err)
		return response.Token
	}
	adminToken, memberToken := tokenFor(admin), tokenFor(member)
	_, err = ts.Store.UpsertInstanceSetting(ctx, &storepb.InstanceSetting{
		Key: storepb.InstanceSettingKey_AI,
		Value: &storepb.InstanceSetting_AiSetting{AiSetting: &storepb.InstanceAISetting{
			Providers: []*storepb.AIProviderConfig{{Id: "openai", Title: "OpenAI", Type: storepb.AIProviderType_OPENAI, ApiKey: "sk-secret"}},
		}},
	})
	require.NoError(t, err)
	for _, content := range []string{"#finance/budget plan", "#finance/budget more", "#travel trip"} {
		_, err := ts.Service.CreateMemo(ts.CreateUserContext(ctx, member.ID), &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: content, Visibility: apipb.Visibility_PRIVATE}})
		require.NoError(t, err)
	}

	var seen struct{ system, user, key string }
	mux := http.NewServeMux()
	llm.New(ctx, ts.Profile, ts.Store, ts.Secret).WithChat(func(_ context.Context, provider ai.ProviderConfig, _ string, system, user string) (string, error) {
		seen.system, seen.user, seen.key = system, user, provider.APIKey
		return "```json\n{\"tags\": [\"#Finance/Budget\", \"finance\", \"two words\", \"travel\", \"saving-goals\", \"x\"]}\n```", nil
	}).RegisterRoutes(mux)
	call := func(token, method, path, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		return recorder
	}

	// Off until an admin turns it on with a provider.
	require.Equal(t, http.StatusFailedDependency, call(memberToken, http.MethodPost, "/api/x/llm/suggest-tags", `{"content":"x"}`).Code)
	require.Equal(t, http.StatusForbidden, call(memberToken, http.MethodPut, "/api/x/llm/features", `{}`).Code)
	require.Equal(t, http.StatusOK, call(adminToken, http.MethodPut, "/api/x/llm/features",
		`{"suggestTags":{"enabled":true,"providerId":"openai","maxTags":3,"allowNew":true},"voiceNote":{"enabled":true,"autoTags":true}}`).Code)

	features := call(memberToken, http.MethodGet, "/api/x/llm/features", "")
	require.JSONEq(t, `{"suggestTags":true,"voiceNote":true,"voiceTags":true,"transcribe":false}`, features.Body.String(),
		"members see what is on, never the configuration or keys")
	require.NotContains(t, call(adminToken, http.MethodGet, "/api/x/llm/features", "").Body.String(), "sk-secret")

	response := call(memberToken, http.MethodPost, "/api/x/llm/suggest-tags", `{"content":"Monthly budget review"}`)
	require.Equal(t, http.StatusOK, response.Code, response.Body.String())
	var body struct {
		Tags []struct {
			Tag      string `json:"tag"`
			Existing bool   `json:"existing"`
		} `json:"tags"`
	}
	require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
	got := []string{}
	for _, tag := range body.Tags {
		got = append(got, tag.Tag)
	}
	// Existing tags in their stored spelling, no parent next to its child, no invalid tag, at most 3.
	require.Equal(t, []string{"finance/budget", "travel", "saving-goals"}, got)
	require.True(t, body.Tags[0].Existing)
	require.False(t, body.Tags[2].Existing)
	require.Equal(t, "sk-secret", seen.key, "the key is used on the server")
	require.Contains(t, seen.user, "finance/budget")
	require.Contains(t, seen.user, "Monthly budget review")
}
