package test

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
	"google.golang.org/protobuf/types/known/fieldmaskpb"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/server/api"
	"github.com/usememos/memos/server/protection"
	"github.com/usememos/memos/server/revision"
)

func TestMemoProtectionAndPasskey(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	revisions := revision.New(ctx, ts.Profile, ts.Store, ts.Secret)
	previous := api.MemoRevisionRecorder
	api.MemoRevisionRecorder = revisions.Record
	t.Cleanup(func() { api.MemoRevisionRecorder = previous })
	mux := http.NewServeMux()
	clock := &fakeClock{now: time.Unix(1_800_000_000, 0)}
	protection.New(ctx, ts.Profile, ts.Store, ts.Secret, revisions).WithClock(clock.Now).RegisterRoutes(mux)

	owner, err := ts.CreateRegularUser(ctx, "protect-owner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "protect-other")
	require.NoError(t, err)
	ownerCtx := ts.CreateUserContext(ctx, owner.ID)
	tokenFor := func(userID int32, username string) string {
		response, err := ts.Service.CreatePersonalAccessToken(ts.CreateUserContext(ctx, userID), &apipb.CreatePersonalAccessTokenRequest{Parent: "users/" + username, Description: "protect"})
		require.NoError(t, err)
		return response.Token
	}
	ownerToken, otherToken := tokenFor(owner.ID, owner.Username), tokenFor(other.ID, other.Username)
	call := func(method, path, token, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		return recorder
	}

	memo, err := ts.Service.CreateMemo(ownerCtx, &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: "# Secret\n\nplain", Visibility: apipb.Visibility_PRIVATE}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(memo.Name, "memos/")
	// Encrypting the memo is a content update: its plaintext becomes a kept version...
	_, err = ts.Service.UpdateMemo(ownerCtx, &apipb.UpdateMemoRequest{
		Memo:       &apipb.Memo{Name: memo.Name, Content: "# Secret\n\n```memos-lock\nciphertext\n```"},
		UpdateMask: &fieldmaskpb.FieldMask{Paths: []string{"content"}},
	})
	require.NoError(t, err)
	kept, err := revisions.List(ctx, uid)
	require.NoError(t, err)
	require.Len(t, kept, 1)

	path := "/api/x/memos/" + uid + "/protection"
	require.Equal(t, http.StatusNotFound, call(http.MethodPut, path, otherToken, `{"mode":"blur"}`).Code, "only the creator protects a memo")
	require.Equal(t, http.StatusBadRequest, call(http.MethodPut, path, ownerToken, `{"mode":"hide"}`).Code)
	require.Equal(t, http.StatusUnauthorized, call(http.MethodPut, path, "", `{"mode":"blur"}`).Code)

	// ...which locking purges.
	require.Equal(t, http.StatusOK, call(http.MethodPut, path, ownerToken, `{"mode":"lock"}`).Code)
	kept, err = revisions.List(ctx, uid)
	require.NoError(t, err)
	require.Empty(t, kept, "locking leaves no plaintext version behind")

	list := func(token string) map[string]string {
		var body struct {
			Protections map[string]string `json:"protections"`
		}
		response := call(http.MethodGet, "/api/x/memo-protections", token, "")
		require.Equal(t, http.StatusOK, response.Code)
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		return body.Protections
	}
	require.Equal(t, map[string]string{uid: "lock"}, list(ownerToken))
	require.Empty(t, list(otherToken), "another user's protections are not listed")

	require.Equal(t, http.StatusOK, call(http.MethodPut, path, ownerToken, `{"mode":"none"}`).Code)
	require.Empty(t, list(ownerToken))

	// Passkey: the server checks a proof and releases the share, with a rate limit.
	b64 := func(fill byte, size int) string {
		return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{fill}, size))
	}
	salt, right, wrong, next := b64('s', 16), b64('r', 32), b64('w', 32), b64('n', 32)
	unlock := func(token, proof string) (int, map[string]any) {
		response := call(http.MethodPost, "/api/x/passkey/unlock", token, `{"proof":"`+proof+`"}`)
		body := map[string]any{}
		require.NoError(t, json.Unmarshal(response.Body.Bytes(), &body))
		return response.Code, body
	}

	require.JSONEq(t, `{"configured":false}`, call(http.MethodGet, "/api/x/passkey", ownerToken, "").Body.String())
	code, _ := unlock(ownerToken, right)
	require.Equal(t, http.StatusNotFound, code)
	require.Equal(t, http.StatusBadRequest, call(http.MethodPut, "/api/x/passkey", ownerToken, `{"salt":"x","proof":"y"}`).Code)
	created := call(http.MethodPut, "/api/x/passkey", ownerToken, `{"salt":"`+salt+`","proof":"`+right+`"}`)
	require.Equal(t, http.StatusOK, created.Code)
	var setup struct {
		Share string `json:"share"`
	}
	require.NoError(t, json.Unmarshal(created.Body.Bytes(), &setup))
	require.NotEmpty(t, setup.Share)
	require.JSONEq(t, `{"configured":true,"salt":"`+salt+`","retryAfter":0}`, call(http.MethodGet, "/api/x/passkey", ownerToken, "").Body.String(),
		"the passkey record never carries the share or the proof")
	require.JSONEq(t, `{"configured":false}`, call(http.MethodGet, "/api/x/passkey", otherToken, "").Body.String())

	code, body := unlock(ownerToken, right)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, setup.Share, body["share"])
	code, _ = unlock(otherToken, right)
	require.Equal(t, http.StatusNotFound, code, "a passkey belongs to its user")

	// Five wrong tries are free; then each one waits, longer every time.
	for attempt := 1; attempt <= protection.FreeAttempts; attempt++ {
		code, body = unlock(ownerToken, wrong)
		require.Equal(t, http.StatusForbidden, code)
		require.EqualValues(t, protection.FreeAttempts-attempt, body["attemptsLeft"])
	}
	require.EqualValues(t, 30, body["retryAfter"])
	code, body = unlock(ownerToken, right)
	require.Equal(t, http.StatusTooManyRequests, code, "even the right passkey waits out the lockout")
	require.Positive(t, body["retryAfter"])
	require.Equal(t, http.StatusTooManyRequests, call(http.MethodPut, "/api/x/passkey", ownerToken,
		`{"salt":"`+salt+`","proof":"`+next+`","currentProof":"`+right+`"}`).Code, "changing the passkey is rate limited too")

	clock.Add(31 * time.Second)
	code, body = unlock(ownerToken, wrong)
	require.Equal(t, http.StatusForbidden, code)
	require.EqualValues(t, 60, body["retryAfter"], "the wait doubles")
	clock.Add(61 * time.Second)
	code, _ = unlock(ownerToken, right)
	require.Equal(t, http.StatusOK, code)
	code, body = unlock(ownerToken, wrong)
	require.Equal(t, http.StatusForbidden, code)
	require.EqualValues(t, protection.FreeAttempts-1, body["attemptsLeft"], "the right passkey resets the count")

	// Changing the passkey needs the current one and keeps the share.
	require.Equal(t, http.StatusForbidden, call(http.MethodPut, "/api/x/passkey", ownerToken,
		`{"salt":"`+salt+`","proof":"`+next+`","currentProof":"`+wrong+`"}`).Code)
	require.Equal(t, http.StatusOK, call(http.MethodPut, "/api/x/passkey", ownerToken,
		`{"salt":"`+salt+`","proof":"`+next+`","currentProof":"`+right+`"}`).Code)
	code, body = unlock(ownerToken, next)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, setup.Share, body["share"])
	code, _ = unlock(ownerToken, right)
	require.Equal(t, http.StatusForbidden, code, "the old passkey no longer opens")
}

type fakeClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) Add(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}
