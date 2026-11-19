package test

import (
	"context"
	"crypto/ecdh"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	apipb "github.com/usememos/memos/proto/gen/api"
	"github.com/usememos/memos/server/reminder"
)

func TestMemoReminders(t *testing.T) {
	ctx := context.Background()
	ts := NewTestService(t)
	defer ts.Cleanup()

	// A local push service standing in for FCM.
	var mu sync.Mutex
	var pushes []*http.Request
	pushService := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = io.ReadAll(r.Body)
		mu.Lock()
		pushes = append(pushes, r)
		mu.Unlock()
		if strings.HasSuffix(r.URL.Path, "/gone") {
			w.WriteHeader(http.StatusGone)
			return
		}
		w.WriteHeader(http.StatusCreated)
	}))
	defer pushService.Close()

	now := time.Date(2026, 11, 19, 1, 0, 0, 0, time.UTC) // 08:00 in Ho Chi Minh City
	clock := func() time.Time { return now }
	service := reminder.New(ctx, ts.Profile, ts.Store, ts.Secret).WithTestHooks(func(endpoint string) bool {
		return strings.HasPrefix(endpoint, pushService.URL)
	}, clock)
	reminder.SetHTTPClientForTest(service, pushService.Client())
	mux := http.NewServeMux()
	service.RegisterRoutes(mux)

	owner, err := ts.CreateRegularUser(ctx, "remind-owner")
	require.NoError(t, err)
	other, err := ts.CreateRegularUser(ctx, "remind-other")
	require.NoError(t, err)
	tokenFor := func(userID int32, username string) string {
		response, err := ts.Service.CreatePersonalAccessToken(ts.CreateUserContext(ctx, userID), &apipb.CreatePersonalAccessTokenRequest{Parent: "users/" + username, Description: "remind"})
		require.NoError(t, err)
		return response.Token
	}
	ownerToken, otherToken := tokenFor(owner.ID, owner.Username), tokenFor(other.ID, other.Username)
	call := func(token, method, path, body string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(method, path, strings.NewReader(body))
		request.Header.Set("Authorization", "Bearer "+token)
		recorder := httptest.NewRecorder()
		mux.ServeHTTP(recorder, request)
		return recorder
	}
	memo, err := ts.Service.CreateMemo(ts.CreateUserContext(ctx, owner.ID), &apipb.CreateMemoRequest{Memo: &apipb.Memo{Content: "# Nộp thuế\n\ntrước cuối tháng", Visibility: apipb.Visibility_PRIVATE}})
	require.NoError(t, err)
	uid := strings.TrimPrefix(memo.Name, "memos/")

	// Devices: a browser key pair, on the push service; addresses elsewhere are refused.
	browserKey, err := ecdh.P256().GenerateKey(rand.Reader)
	require.NoError(t, err)
	keys := `"keys":{"p256dh":"` + base64.RawURLEncoding.EncodeToString(browserKey.PublicKey().Bytes()) + `","auth":"` + base64.RawURLEncoding.EncodeToString(make([]byte, 16)) + `"}`
	require.Equal(t, http.StatusBadRequest, call(ownerToken, http.MethodPost, "/api/x/push/subscriptions", `{"endpoint":"https://169.254.169.254/x",`+keys+`}`).Code)
	require.Equal(t, http.StatusOK, call(ownerToken, http.MethodPost, "/api/x/push/subscriptions", `{"endpoint":"`+pushService.URL+`/device",`+keys+`}`).Code)
	require.Equal(t, http.StatusOK, call(ownerToken, http.MethodPost, "/api/x/push/subscriptions", `{"endpoint":"`+pushService.URL+`/gone",`+keys+`}`).Code)
	var key struct {
		PublicKey string `json:"publicKey"`
	}
	require.NoError(t, json.Unmarshal(call(ownerToken, http.MethodGet, "/api/x/push/key", "").Body.Bytes(), &key))
	require.NotEmpty(t, key.PublicKey)

	// Reminders: only on your own memo, in the future (unless repeating), with a known repeat.
	path := "/api/x/memos/" + uid + "/reminders"
	require.Equal(t, http.StatusNotFound, call(otherToken, http.MethodPost, path, `{"at":"2026-11-19T09:00","tz":"Asia/Ho_Chi_Minh"}`).Code)
	require.Equal(t, http.StatusBadRequest, call(ownerToken, http.MethodPost, path, `{"at":"2026-11-19T07:00","tz":"Asia/Ho_Chi_Minh"}`).Code, "past one-off")
	require.Equal(t, http.StatusBadRequest, call(ownerToken, http.MethodPost, path, `{"at":"2026-11-19T09:00","tz":"Asia/Ho_Chi_Minh","repeat":"hourly"}`).Code)
	require.Equal(t, http.StatusOK, call(ownerToken, http.MethodPost, path, `{"at":"2026-11-19T09:00","tz":"Asia/Ho_Chi_Minh"}`).Code)
	daily := call(ownerToken, http.MethodPost, path, `{"at":"2026-11-18T08:30","tz":"Asia/Ho_Chi_Minh","repeat":"daily"}`)
	require.Equal(t, http.StatusOK, daily.Code)
	var created reminder.Reminder
	require.NoError(t, json.Unmarshal(daily.Body.Bytes(), &created))
	require.Equal(t, time.Date(2026, 11, 19, 1, 30, 0, 0, time.UTC).Unix(), created.NextAt, "a past repeating start moves to its next occurrence")

	// Nothing is due yet.
	service.RunDue(ctx)
	require.Empty(t, pushes)

	// 09:05 local: both are due. The first push also finds the expired device, which is dropped
	// at once, so the second goes to the live device only.
	now = time.Date(2026, 11, 19, 2, 5, 0, 0, time.UTC)
	service.RunDue(ctx)
	require.Len(t, pushes, 3)
	require.Equal(t, "aes128gcm", pushes[0].Header.Get("Content-Encoding"))
	require.True(t, strings.HasPrefix(pushes[0].Header.Get("Authorization"), "vapid t="))

	var list struct {
		Reminders []reminder.Reminder `json:"reminders"`
	}
	require.NoError(t, json.Unmarshal(call(ownerToken, http.MethodGet, path, "").Body.Bytes(), &list))
	require.Len(t, list.Reminders, 1, "the one-off reminder is done; the daily one stays")
	require.Equal(t, time.Date(2026, 11, 20, 1, 30, 0, 0, time.UTC).Unix(), list.Reminders[0].NextAt)

	pushes = nil
	now = time.Date(2026, 11, 20, 1, 31, 0, 0, time.UTC)
	service.RunDue(ctx)
	require.Len(t, pushes, 1, "the daily reminder, to the live device only")

	require.Equal(t, http.StatusNotFound, call(otherToken, http.MethodDelete, "/api/x/reminders/"+strconv.FormatInt(list.Reminders[0].ID, 10), "").Code)
	require.Equal(t, http.StatusOK, call(ownerToken, http.MethodDelete, "/api/x/reminders/"+strconv.FormatInt(list.Reminders[0].ID, 10), "").Code)
}
