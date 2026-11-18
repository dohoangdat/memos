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
	"google.golang.org/protobuf/types/known/timestamppb"

	apipb "github.com/usememos/memos/proto/gen/api"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/server/api"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/server/protection"
	"github.com/usememos/memos/server/revision"
	"github.com/usememos/memos/server/tagrename"
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
	protection.New(ctx, ts.Profile, ts.Store, ts.Secret, revisions, "").WithClock(clock.Now).RegisterRoutes(mux)

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

func TestPasskeyPepper(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	owner, err := ts.CreateRegularUser(ctx, "pepper-owner")
	require.NoError(t, err)
	token, err := ts.Service.CreatePersonalAccessToken(ts.CreateUserContext(ctx, owner.ID),
		&apipb.CreatePersonalAccessTokenRequest{Parent: "users/" + owner.Username, Description: "pepper"})
	require.NoError(t, err)
	serve := func(pepper string) *http.ServeMux {
		mux := http.NewServeMux()
		protection.New(ctx, ts.Profile, ts.Store, ts.Secret, nil, pepper).RegisterRoutes(mux)
		return mux
	}
	call := func(mux *http.ServeMux, method, path, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token.Token)
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		return recorder
	}
	stored := func() (share, proofHash string) {
		require.NoError(t, ts.Store.GetDriver().GetDB().QueryRowContext(ctx,
			"SELECT share, proof_hash FROM memo_passkey WHERE user_id = ?", owner.ID).Scan(&share, &proofHash))
		return share, proofHash
	}
	unlockShare := func(mux *http.ServeMux, proof string) (int, string) {
		response := call(mux, http.MethodPost, "/api/x/passkey/unlock", `{"proof":"`+proof+`"}`)
		var body struct {
			Share string `json:"share"`
		}
		_ = json.Unmarshal(response.Body.Bytes(), &body)
		return response.Code, body.Share
	}
	b64 := func(fill byte, size int) string {
		return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{fill}, size))
	}
	salt, proof := b64('s', 16), b64('p', 32)
	pepper := strings.Repeat("k", protection.MinPepperLength)

	if ts.Profile.Driver == "sqlite" {
		var secureDelete int
		require.NoError(t, ts.Store.GetDriver().GetDB().QueryRowContext(ctx, "PRAGMA secure_delete").Scan(&secureDelete))
		require.Equal(t, 1, secureDelete, "deleted plaintext is zeroed in the database file")
	}

	// A passkey set up before the pepper (as on a running server)...
	plain := serve("")
	require.Equal(t, http.StatusOK, call(plain, http.MethodPut, "/api/x/passkey", `{"salt":"`+salt+`","proof":"`+proof+`"}`).Code)
	_, original := unlockShare(plain, proof)
	share, proofHash := stored()
	require.Equal(t, original, share, "without the pepper the share is stored as is")

	// ...is sealed as soon as the server starts with one, and opens to the same share.
	peppered := serve(pepper)
	share, _ = stored()
	require.True(t, strings.HasPrefix(share, "v1:"))
	require.NotContains(t, share, original)
	code, got := unlockShare(peppered, proof)
	require.Equal(t, http.StatusOK, code)
	require.Equal(t, original, got, "locked memos keep opening")
	_, upgraded := stored()
	require.NotEqual(t, proofHash, upgraded, "the right passkey upgrades its stored proof")
	require.True(t, strings.HasPrefix(upgraded, "v1:"))
	code, _ = unlockShare(peppered, b64('w', 32))
	require.Equal(t, http.StatusForbidden, code)

	// Without the pepper (a copy of the database elsewhere) nothing opens.
	code, _ = unlockShare(serve(""), proof)
	require.NotEqual(t, http.StatusOK, code)
	// A pepper too short disables the feature rather than storing weakly.
	require.Equal(t, http.StatusNotImplemented, call(serve("short"), http.MethodGet, "/api/x/passkey", "").Code)
	// Changing the passkey keeps the share.
	next := b64('n', 32)
	require.Equal(t, http.StatusOK, call(peppered, http.MethodPut, "/api/x/passkey", `{"salt":"`+salt+`","proof":"`+next+`","currentProof":"`+proof+`"}`).Code)
	_, got = unlockShare(peppered, next)
	require.Equal(t, original, got)
}

func TestForkEndpointsIgnoreTheRefreshCookie(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()
	owner, err := ts.CreateRegularUser(ctx, "cookie-owner")
	require.NoError(t, err)
	// A real, stored refresh token: it would sign the user in through the cookie fallback.
	refreshToken, expiresAt, err := auth.GenerateRefreshToken(owner.ID, "cookie-token", []byte(ts.Secret))
	require.NoError(t, err)
	require.NoError(t, ts.Store.AddUserRefreshToken(ctx, owner.ID, &storepb.RefreshTokensUserSetting_RefreshToken{
		TokenId: "cookie-token", ExpiresAt: timestamppb.New(expiresAt), CreatedAt: timestamppb.Now(),
	}))
	user, err := auth.NewAuthenticator(ts.Store, ts.Secret).AuthenticateToUser(ctx, "", auth.RefreshTokenCookieName+"="+refreshToken)
	require.NoError(t, err)
	require.NotNil(t, user, "the cookie is valid")

	mux := http.NewServeMux()
	protection.New(ctx, ts.Profile, ts.Store, ts.Secret, nil, "").RegisterRoutes(mux)
	tagrename.New(ts.Store, ts.Secret, ts.Service).RegisterRoutes(mux)
	// A same-site page can make the browser send the refresh cookie, but never a bearer token.
	for _, route := range []struct{ method, path, body string }{
		{http.MethodGet, "/api/x/passkey", ""},
		{http.MethodPost, "/api/x/passkey/unlock", `{"proof":"x"}`},
		{http.MethodGet, "/api/x/memo-protections", ""},
		{http.MethodPost, "/api/x/tags/rename", `{"from":"a","to":"b"}`},
	} {
		request := httptest.NewRequest(route.method, route.path, strings.NewReader(route.body))
		request.Header.Set("Cookie", auth.RefreshTokenCookieName+"="+refreshToken)
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		require.Equal(t, http.StatusUnauthorized, recorder.Code, route.path)
	}
}
