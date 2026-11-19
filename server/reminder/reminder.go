// Package reminder reminds the owner of a memo at a set time, once or repeating, with a push
// notification to every device they enabled (Web Push; see webpush.go).
//
//   - GET    /api/x/push/key                     the server's VAPID public key
//   - POST   /api/x/push/subscriptions           this device's push subscription
//   - DELETE /api/x/push/subscriptions           forget this device ({endpoint})
//   - POST   /api/x/push/test                    a test notification to the caller's devices
//   - GET    /api/x/reminders                    the caller's upcoming reminders
//   - GET    /api/x/memos/{uid}/reminders        a memo's reminders
//   - POST   /api/x/memos/{uid}/reminders        {at: "2026-11-20T09:00", tz, repeat}
//   - DELETE /api/x/reminders/{id}
//
// A scheduler checks every 30 seconds for due reminders. Fork-only tables, created with IF NOT
// EXISTS outside the upstream migrations (SQLite only).
package reminder

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"sync"
	"time"
	// Reminders repeat in the owner's time zone; the image may have no zoneinfo.
	_ "time/tzdata"

	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const schema = `
CREATE TABLE IF NOT EXISTS memo_reminder (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  memo_uid TEXT NOT NULL,
  next_at BIGINT NOT NULL,
  repeat TEXT NOT NULL,
  tz TEXT NOT NULL,
  created_ts BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_memo_reminder_next_at ON memo_reminder (next_at);
CREATE TABLE IF NOT EXISTS push_subscription (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  user_agent TEXT NOT NULL,
  created_ts BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS push_vapid (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  private_key TEXT NOT NULL
);
`

// Repeat rules.
const (
	RepeatNone    = "none"
	RepeatDaily   = "daily"
	RepeatWeekly  = "weekly"
	RepeatMonthly = "monthly"
	RepeatYearly  = "yearly"
)

var repeats = map[string]bool{RepeatNone: true, RepeatDaily: true, RepeatWeekly: true, RepeatMonthly: true, RepeatYearly: true}

const (
	tickInterval     = 30 * time.Second
	maxPerMemo       = 20
	maxSubscriptions = 20
	pushTTL          = 24 * time.Hour
)

// pushHosts are the browsers' push services; subscriptions elsewhere are refused, so the server
// never posts to an address a user picked (SSRF).
var pushHosts = []string{
	"fcm.googleapis.com", "android.googleapis.com", // Chrome, Edge on Android, Samsung
	"push.services.mozilla.com", // Firefox
	"push.apple.com",            // Safari, iOS home-screen apps
	"notify.windows.com",        // Edge on Windows
}

func allowedPushEndpoint(endpoint string) bool {
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme != "https" || parsed.User != nil || len(endpoint) > 2048 {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	for _, allowed := range pushHosts {
		if host == allowed || strings.HasSuffix(host, "."+allowed) {
			return true
		}
	}
	return false
}

type subscription struct {
	ID       int64
	Endpoint string
	P256dh   string
	Auth     string
}

// Service serves reminders and push subscriptions and runs the scheduler.
type Service struct {
	db            *sql.DB
	store         *store.Store
	authenticator *auth.Authenticator
	keys          *vapidKeys
	subject       string
	client        *http.Client
	allowEndpoint func(string) bool
	now           func() time.Time
	enabled       bool
	tick          sync.Mutex
}

// New prepares the tables and the VAPID keys. A failure disables reminders instead of stopping
// the server.
func New(ctx context.Context, p *profile.Profile, s *store.Store, secret string) *Service {
	service := &Service{
		db:            s.GetDriver().GetDB(),
		store:         s,
		authenticator: auth.NewAuthenticator(s, secret),
		client:        &http.Client{Timeout: 15 * time.Second},
		allowEndpoint: allowedPushEndpoint,
		now:           time.Now,
		subject:       "mailto:noreply@memos.invalid",
	}
	if strings.HasPrefix(p.InstanceURL, "https://") {
		service.subject = strings.TrimRight(p.InstanceURL, "/")
	}
	if p.Driver != "sqlite" {
		slog.Info("reminders are only available on sqlite; disabled", slog.String("driver", p.Driver))
		return service
	}
	if _, err := service.db.ExecContext(ctx, schema); err != nil {
		slog.Warn("reminders disabled: failed to prepare tables", slog.String("error", err.Error()))
		return service
	}
	keys, err := service.loadKeys(ctx)
	if err != nil {
		slog.Warn("reminders disabled: failed to prepare push keys", slog.String("error", err.Error()))
		return service
	}
	service.keys = keys
	service.enabled = true
	return service
}

// WithTestHooks lets tests post to a local push service and set the clock.
func (s *Service) WithTestHooks(allowEndpoint func(string) bool, now func() time.Time) *Service {
	s.allowEndpoint, s.now = allowEndpoint, now
	return s
}

func (s *Service) loadKeys(ctx context.Context) (*vapidKeys, error) {
	var stored string
	err := s.db.QueryRowContext(ctx, "SELECT private_key FROM push_vapid WHERE id = 1").Scan(&stored)
	if err == nil {
		raw, err := decodeKey(stored)
		if err != nil {
			return nil, err
		}
		return loadVAPIDKeys(raw)
	}
	if err != sql.ErrNoRows {
		return nil, err
	}
	keys, raw, err := newVAPIDKeys()
	if err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(ctx, "INSERT INTO push_vapid (id, private_key) VALUES (1, ?)", b64.EncodeToString(raw)); err != nil {
		return nil, err
	}
	return keys, nil
}

// RegisterRoutes serves the endpoints.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/x/push/key", httphandler.Func(s.getKey))
	mux.Handle("POST /api/x/push/subscriptions", httphandler.Func(s.subscribe))
	mux.Handle("DELETE /api/x/push/subscriptions", httphandler.Func(s.unsubscribe))
	mux.Handle("POST /api/x/push/test", httphandler.Func(s.test))
	mux.Handle("GET /api/x/reminders", httphandler.Func(s.listUpcoming))
	mux.Handle("GET /api/x/memos/{uid}/reminders", httphandler.Func(s.listForMemo))
	mux.Handle("POST /api/x/memos/{uid}/reminders", httphandler.Func(s.create))
	mux.Handle("DELETE /api/x/reminders/{id}", httphandler.Func(s.remove))
}

// Run runs the scheduler until ctx ends.
func (s *Service) Run(ctx context.Context) {
	if !s.enabled {
		return
	}
	ticker := time.NewTicker(tickInterval)
	defer ticker.Stop()
	for {
		s.RunDue(ctx)
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}

func (s *Service) caller(r *http.Request) (*store.User, error) {
	if !s.enabled {
		return nil, &httphandler.Error{Code: http.StatusNotImplemented, Message: "reminders are not available"}
	}
	// Bearer token only, like every fork endpoint (see server/protection).
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), "")
	if err != nil || user == nil {
		return nil, &httphandler.Error{Code: http.StatusUnauthorized, Message: "authentication required"}
	}
	return user, nil
}

func noStore(w http.ResponseWriter) { w.Header().Set("Cache-Control", "private, no-store") }

func (s *Service) getKey(w http.ResponseWriter, r *http.Request) error {
	if _, err := s.caller(r); err != nil {
		return err
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"publicKey": b64.EncodeToString(s.keys.public)})
}

func (s *Service) subscribe(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	var body struct {
		Endpoint string `json:"endpoint"`
		Keys     struct {
			P256dh string `json:"p256dh"`
			Auth   string `json:"auth"`
		} `json:"keys"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8<<10)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	if !s.allowEndpoint(body.Endpoint) {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "unsupported push service"}
	}
	p256dh, err1 := decodeKey(body.Keys.P256dh)
	auth, err2 := decodeKey(body.Keys.Auth)
	if err1 != nil || err2 != nil || len(p256dh) != 65 || len(auth) != 16 {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid subscription keys"}
	}
	ctx := r.Context()
	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM push_subscription WHERE user_id = ? AND endpoint != ?", user.ID, body.Endpoint).Scan(&count); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the device", Cause: err}
	}
	if count >= maxSubscriptions {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "too many devices"}
	}
	agent := r.UserAgent()
	if len(agent) > 300 {
		agent = agent[:300]
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO push_subscription (user_id, endpoint, p256dh, auth, user_agent, created_ts) VALUES (?, ?, ?, ?, ?, ?)
		 ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
		   user_agent = excluded.user_agent`,
		user.ID, body.Endpoint, body.Keys.P256dh, body.Keys.Auth, agent, s.now().Unix()); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the device", Cause: err}
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (s *Service) unsubscribe(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	var body struct {
		Endpoint string `json:"endpoint"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	if _, err := s.db.ExecContext(r.Context(), "DELETE FROM push_subscription WHERE user_id = ? AND endpoint = ?", user.ID, body.Endpoint); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to forget the device", Cause: err}
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// notification is what the service worker shows.
type notification struct {
	Title string `json:"title"`
	Body  string `json:"body"`
	URL   string `json:"url"`
	Tag   string `json:"tag"`
}

// pushTo sends one notification to all of a user's devices, dropping expired subscriptions.
func (s *Service) pushTo(ctx context.Context, userID int32, message notification) (sent, failed int) {
	payload, err := json.Marshal(message)
	if err != nil {
		return 0, 0
	}
	rows, err := s.db.QueryContext(ctx, "SELECT id, endpoint, p256dh, auth FROM push_subscription WHERE user_id = ?", userID)
	if err != nil {
		slog.Warn("failed to list push subscriptions", slog.String("error", err.Error()))
		return 0, 0
	}
	var subs []subscription
	for rows.Next() {
		var sub subscription
		if rows.Scan(&sub.ID, &sub.Endpoint, &sub.P256dh, &sub.Auth) == nil {
			subs = append(subs, sub)
		}
	}
	rows.Close()
	for _, sub := range subs {
		if !s.allowEndpoint(sub.Endpoint) {
			continue
		}
		err := send(ctx, s.client, s.keys, s.subject, sub, payload, pushTTL)
		switch {
		case err == nil:
			sent++
		case err == errGone:
			_, _ = s.db.ExecContext(ctx, "DELETE FROM push_subscription WHERE id = ?", sub.ID)
			failed++
		default:
			slog.Warn("push failed", slog.String("error", err.Error()))
			failed++
		}
	}
	return sent, failed
}

func (s *Service) test(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	sent, failed := s.pushTo(r.Context(), user.ID, notification{Title: "⏰ Memos", Body: "Notifications work on this device.", URL: "/", Tag: "test"})
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"sent": sent, "failed": failed})
}

// Reminder is one reminder as the API answers it.
type Reminder struct {
	ID      int64  `json:"id"`
	MemoUID string `json:"memoUid"`
	NextAt  int64  `json:"nextAt"`
	Repeat  string `json:"repeat"`
	TZ      string `json:"tz"`
}

func (s *Service) query(ctx context.Context, where string, args ...any) ([]Reminder, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id, memo_uid, next_at, repeat, tz FROM memo_reminder WHERE "+where+" ORDER BY next_at", args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := []Reminder{}
	for rows.Next() {
		var item Reminder
		if err := rows.Scan(&item.ID, &item.MemoUID, &item.NextAt, &item.Repeat, &item.TZ); err != nil {
			return nil, err
		}
		list = append(list, item)
	}
	return list, rows.Err()
}

func (s *Service) listUpcoming(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	list, err := s.query(r.Context(), "user_id = ?", user.ID)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list reminders", Cause: err}
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"reminders": list})
}

// ownMemo checks that the caller created the memo.
func (s *Service) ownMemo(ctx context.Context, user *store.User, uid string) error {
	memo, err := s.store.GetMemo(ctx, &store.FindMemo{UID: &uid, ExcludeContent: true})
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to get memo", Cause: err}
	}
	if memo == nil || memo.CreatorID != user.ID {
		return &httphandler.Error{Code: http.StatusNotFound, Message: "memo not found"}
	}
	return nil
}

func (s *Service) listForMemo(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	uid := r.PathValue("uid")
	if err := s.ownMemo(r.Context(), user, uid); err != nil {
		return err
	}
	list, err := s.query(r.Context(), "user_id = ? AND memo_uid = ?", user.ID, uid)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list reminders", Cause: err}
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"reminders": list})
}

func (s *Service) create(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	uid := r.PathValue("uid")
	if err := s.ownMemo(ctx, user, uid); err != nil {
		return err
	}
	var body struct {
		At     string `json:"at"`
		TZ     string `json:"tz"`
		Repeat string `json:"repeat"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2<<10)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	if body.Repeat == "" {
		body.Repeat = RepeatNone
	}
	if !repeats[body.Repeat] {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "repeat must be none, daily, weekly, monthly or yearly"}
	}
	location, err := time.LoadLocation(body.TZ)
	if err != nil || body.TZ == "" {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid time zone"}
	}
	at, err := time.ParseInLocation("2006-01-02T15:04", body.At, location)
	if err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid time; expected 2006-01-02T15:04"}
	}
	next := at
	if !next.After(s.now()) {
		if body.Repeat == RepeatNone {
			return &httphandler.Error{Code: http.StatusBadRequest, Message: "the time is in the past"}
		}
		next = advance(next, body.Repeat, s.now())
	}
	var count int
	if err := s.db.QueryRowContext(ctx, "SELECT COUNT(*) FROM memo_reminder WHERE memo_uid = ?", uid).Scan(&count); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the reminder", Cause: err}
	}
	if count >= maxPerMemo {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "too many reminders on this memo"}
	}
	result, err := s.db.ExecContext(ctx,
		"INSERT INTO memo_reminder (user_id, memo_uid, next_at, repeat, tz, created_ts) VALUES (?, ?, ?, ?, ?, ?)",
		user.ID, uid, next.Unix(), body.Repeat, body.TZ, s.now().Unix())
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save the reminder", Cause: err}
	}
	id, _ := result.LastInsertId()
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, Reminder{ID: id, MemoUID: uid, NextAt: next.Unix(), Repeat: body.Repeat, TZ: body.TZ})
}

func (s *Service) remove(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
	if err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid id"}
	}
	result, err := s.db.ExecContext(r.Context(), "DELETE FROM memo_reminder WHERE id = ? AND user_id = ?", id, user.ID)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to delete the reminder", Cause: err}
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return &httphandler.Error{Code: http.StatusNotFound, Message: "reminder not found"}
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"ok": true})
}

// addRepeat moves t one step on, in t's own location. A monthly or yearly reminder on a day the
// next month lacks (the 31st, 29 February) falls on that month's last day.
func addRepeat(t time.Time, repeat string, original int) time.Time {
	switch repeat {
	case RepeatDaily:
		return t.AddDate(0, 0, 1)
	case RepeatWeekly:
		return t.AddDate(0, 0, 7)
	case RepeatMonthly, RepeatYearly:
		months := 1
		if repeat == RepeatYearly {
			months = 12
		}
		first := time.Date(t.Year(), t.Month(), 1, t.Hour(), t.Minute(), t.Second(), 0, t.Location()).AddDate(0, months, 0)
		last := first.AddDate(0, 1, -1).Day()
		return time.Date(first.Year(), first.Month(), min(original, last), t.Hour(), t.Minute(), t.Second(), 0, t.Location())
	default:
		return t
	}
}

// advance is the first occurrence of a repeating reminder after now.
func advance(t time.Time, repeat string, now time.Time) time.Time {
	original := t.Day()
	for i := 0; !t.After(now) && i < 100000; i++ {
		t = addRepeat(t, repeat, original)
	}
	return t
}

// RunDue sends the reminders that are due and schedules their next occurrence.
func (s *Service) RunDue(ctx context.Context) {
	if !s.tick.TryLock() {
		return
	}
	defer s.tick.Unlock()
	now := s.now()
	rows, err := s.db.QueryContext(ctx, "SELECT id, user_id, memo_uid, next_at, repeat, tz FROM memo_reminder WHERE next_at <= ?", now.Unix())
	if err != nil {
		slog.Warn("failed to read due reminders", slog.String("error", err.Error()))
		return
	}
	type due struct {
		id              int64
		userID          int32
		memoUID, repeat string
		nextAt          int64
		tz              string
	}
	var list []due
	for rows.Next() {
		var item due
		if rows.Scan(&item.id, &item.userID, &item.memoUID, &item.nextAt, &item.repeat, &item.tz) == nil {
			list = append(list, item)
		}
	}
	rows.Close()
	for _, item := range list {
		uid := item.memoUID
		memo, err := s.store.GetMemo(ctx, &store.FindMemo{UID: &uid})
		if err != nil {
			continue
		}
		if memo == nil {
			_, _ = s.db.ExecContext(ctx, "DELETE FROM memo_reminder WHERE id = ?", item.id)
			continue
		}
		title, body := summarize(memo.Content)
		s.pushTo(ctx, item.userID, notification{Title: "⏰ " + title, Body: body, URL: "/memos/" + uid, Tag: "reminder-" + strconv.FormatInt(item.id, 10)})
		if item.repeat == RepeatNone {
			_, _ = s.db.ExecContext(ctx, "DELETE FROM memo_reminder WHERE id = ?", item.id)
			continue
		}
		location, err := time.LoadLocation(item.tz)
		if err != nil {
			location = time.UTC
		}
		next := advance(time.Unix(item.nextAt, 0).In(location), item.repeat, now)
		_, _ = s.db.ExecContext(ctx, "UPDATE memo_reminder SET next_at = ? WHERE id = ?", next.Unix(), item.id)
	}
}

// summarize is a notification's title and body: the memo's first line, then the next text.
// A locked memo shows only its title.
func summarize(content string) (string, string) {
	locked := strings.Contains(content, "```memos-lock")
	lines := []string{}
	for _, line := range strings.Split(content, "\n") {
		line = strings.TrimSpace(strings.TrimLeft(strings.TrimSpace(line), "#>-*"))
		if line != "" && !strings.HasPrefix(line, "```") {
			lines = append(lines, line)
		}
	}
	cut := func(text string, size int) string {
		runes := []rune(text)
		if len(runes) > size {
			return string(runes[:size]) + "…"
		}
		return text
	}
	if len(lines) == 0 {
		return "Memo", ""
	}
	if locked {
		return cut(lines[0], 80), "🔒"
	}
	body := ""
	if len(lines) > 1 {
		body = cut(strings.Join(lines[1:], " "), 160)
	}
	return cut(lines[0], 80), body
}

// SetHTTPClientForTest posts to a test push service.
func SetHTTPClientForTest(s *Service, client *http.Client) { s.client = client }
