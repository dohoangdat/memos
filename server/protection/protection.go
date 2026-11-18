// Package protection keeps how a memo is protected in lists (blurred, or
// locked with the owner's passkey) and gates the owner's passkey. Locked memos
// are encrypted in the browser before they are saved: the server only ever
// holds ciphertext, never the passkey or the plaintext.
//
// The passkey has six digits, so it is checked here, with a rate limit, rather
// than in the browser. The browser stretches the passkey into a proof and a
// half it keeps; the server stores a hash of the proof and a random share, and
// releases the share only for the right proof. The memo key needs both halves,
// so nothing a client holds before unlocking lets it test passkeys offline.
//
// Fork-only, in its own package and tables (created with IF NOT EXISTS,
// outside the upstream migration sequence), SQLite only.
package protection

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"log/slog"
	"net/http"
	"strconv"
	"sync"
	"time"

	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const (
	// ModeBlur hides a memo's body in lists until it is opened.
	ModeBlur = "blur"
	// ModeLock also needs the passkey to open; the content is encrypted.
	ModeLock = "lock"
)

const schema = `
CREATE TABLE IF NOT EXISTS memo_protection (
  memo_uid TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  updated_ts BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS memo_passkey (
  user_id INTEGER PRIMARY KEY,
  salt TEXT NOT NULL,
  proof_hash TEXT NOT NULL,
  share TEXT NOT NULL,
  failed_count INTEGER NOT NULL DEFAULT 0,
  locked_until BIGINT NOT NULL DEFAULT 0,
  updated_ts BIGINT NOT NULL
);
`

const (
	// FreeAttempts is how many wrong passkeys in a row are allowed before waiting.
	FreeAttempts = 5
	// firstLockout is the wait after FreeAttempts wrong passkeys; it doubles with each further
	// wrong one, up to maxLockout. Trying all million passkeys would take a century.
	firstLockout = 30 * time.Second
	maxLockout   = time.Hour
)

// lockoutAfter is how long a user waits after their failed-th wrong passkey in a row.
func lockoutAfter(failed int) time.Duration {
	if failed < FreeAttempts {
		return 0
	}
	wait := firstLockout
	for i := FreeAttempts; i < failed && wait < maxLockout; i++ {
		wait *= 2
	}
	return min(wait, maxLockout)
}

func decodeBase64(value string, size int) ([]byte, bool) {
	decoded, err := base64.StdEncoding.DecodeString(value)
	return decoded, err == nil && len(decoded) == size
}

func hashProof(proof []byte) string {
	sum := sha256.Sum256(proof)
	return hex.EncodeToString(sum[:])
}

// Purger removes a memo's kept versions when it is locked.
type Purger interface {
	Purge(ctx context.Context, memoUID string) error
}

// Service serves memo protection modes and the passkey verifier.
type Service struct {
	db            *sql.DB
	store         *store.Store
	authenticator *auth.Authenticator
	revisions     Purger
	enabled       bool
	now           func() time.Time
	// attempts serializes passkey checks so concurrent guesses cannot share one allowance.
	attempts sync.Mutex
}

// New prepares the tables. A failure disables the feature instead of stopping the server.
func New(ctx context.Context, p *profile.Profile, s *store.Store, secret string, revisions Purger) *Service {
	service := &Service{db: s.GetDriver().GetDB(), store: s, authenticator: auth.NewAuthenticator(s, secret), revisions: revisions, now: time.Now}
	if p.Driver != "sqlite" {
		slog.Info("memo protection is only available on sqlite; disabled", slog.String("driver", p.Driver))
		return service
	}
	if _, err := service.db.ExecContext(ctx, schema); err != nil {
		slog.Warn("memo protection disabled: failed to prepare tables", slog.String("error", err.Error()))
		return service
	}
	service.enabled = true
	return service
}

// WithClock replaces the clock the rate limit reads; for tests.
func (s *Service) WithClock(now func() time.Time) *Service {
	s.now = now
	return s
}

// RegisterRoutes serves the protection and passkey endpoints to signed-in users.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/x/memo-protections", httphandler.Func(s.listProtections))
	mux.Handle("PUT /api/x/memos/{uid}/protection", httphandler.Func(s.setProtection))
	mux.Handle("GET /api/x/passkey", httphandler.Func(s.getPasskey))
	mux.Handle("PUT /api/x/passkey", httphandler.Func(s.setPasskey))
	mux.Handle("POST /api/x/passkey/unlock", httphandler.Func(s.unlockPasskey))
}

func (s *Service) user(r *http.Request) (*store.User, error) {
	if !s.enabled {
		return nil, &httphandler.Error{Code: http.StatusNotImplemented, Message: "memo protection is not available"}
	}
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), r.Header.Get("Cookie"))
	if err != nil || user == nil {
		return nil, &httphandler.Error{Code: http.StatusUnauthorized, Message: "authentication required"}
	}
	return user, nil
}

func noStore(w http.ResponseWriter) { w.Header().Set("Cache-Control", "private, no-store") }

// listProtections answers {protections: {uid: mode}} for the caller's own memos.
func (s *Service) listProtections(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	rows, err := s.db.QueryContext(r.Context(),
		`SELECT p.memo_uid, p.mode FROM memo_protection p JOIN memo m ON m.uid = p.memo_uid WHERE m.creator_id = ?`, user.ID)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list protections", Cause: err}
	}
	defer rows.Close()
	protections := map[string]string{}
	for rows.Next() {
		var uid, mode string
		if err := rows.Scan(&uid, &mode); err != nil {
			return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list protections", Cause: err}
		}
		protections[uid] = mode
	}
	if err := rows.Err(); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list protections", Cause: err}
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"protections": protections})
}

// setProtection sets a memo's mode ("blur", "lock", or "none" to clear it). Only the memo's
// creator may. Locking purges the memo's kept versions: the client saves the encrypted content
// first, so the versions it would purge are the plaintext ones.
func (s *Service) setProtection(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	var body struct {
		Mode string `json:"mode"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	if body.Mode != ModeBlur && body.Mode != ModeLock && body.Mode != "none" {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "mode must be blur, lock or none"}
	}
	ctx := r.Context()
	uid := r.PathValue("uid")
	memo, err := s.store.GetMemo(ctx, &store.FindMemo{UID: &uid})
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to get memo", Cause: err}
	}
	if memo == nil || memo.CreatorID != user.ID {
		return &httphandler.Error{Code: http.StatusNotFound, Message: "memo not found"}
	}
	if body.Mode == "none" {
		_, err = s.db.ExecContext(ctx, "DELETE FROM memo_protection WHERE memo_uid = ?", uid)
	} else {
		_, err = s.db.ExecContext(ctx,
			`INSERT INTO memo_protection (memo_uid, mode, updated_ts) VALUES (?, ?, ?)
			 ON CONFLICT(memo_uid) DO UPDATE SET mode = excluded.mode, updated_ts = excluded.updated_ts`,
			uid, body.Mode, time.Now().Unix())
	}
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save protection", Cause: err}
	}
	if body.Mode == ModeLock && s.revisions != nil {
		if err := s.revisions.Purge(ctx, uid); err != nil {
			return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to clear earlier versions", Cause: err}
		}
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"mode": body.Mode})
}

type passkeyRow struct {
	salt        string
	proofHash   string
	share       string
	failed      int
	lockedUntil int64
}

func (s *Service) loadPasskey(ctx context.Context, userID int32) (*passkeyRow, error) {
	row := &passkeyRow{}
	err := s.db.QueryRowContext(ctx, "SELECT salt, proof_hash, share, failed_count, locked_until FROM memo_passkey WHERE user_id = ?", userID).
		Scan(&row.salt, &row.proofHash, &row.share, &row.failed, &row.lockedUntil)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to get passkey", Cause: err}
	}
	return row, nil
}

// retryAfter is how many seconds the user must still wait before trying a passkey, or 0.
func (s *Service) retryAfter(row *passkeyRow) int64 {
	return max(0, row.lockedUntil-s.now().Unix())
}

// checkProof tests a passkey proof against the user's, counting wrong ones. It answers
// nil for the right proof and writes the refusal itself otherwise (ok false).
// The caller holds s.attempts.
func (s *Service) checkProof(w http.ResponseWriter, r *http.Request, userID int32, row *passkeyRow, proof string) (bool, error) {
	noStore(w)
	if wait := s.retryAfter(row); wait > 0 {
		w.Header().Set("Retry-After", strconv.FormatInt(wait, 10))
		return false, httphandler.JSON(w, http.StatusTooManyRequests, map[string]any{"message": "too many wrong passkeys", "retryAfter": wait})
	}
	decoded, valid := decodeBase64(proof, 32)
	if valid && subtle.ConstantTimeCompare([]byte(hashProof(decoded)), []byte(row.proofHash)) == 1 {
		if row.failed != 0 {
			if _, err := s.db.ExecContext(r.Context(), "UPDATE memo_passkey SET failed_count = 0, locked_until = 0 WHERE user_id = ?", userID); err != nil {
				return false, &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save passkey", Cause: err}
			}
		}
		return true, nil
	}
	failed := row.failed + 1
	wait := int64(lockoutAfter(failed) / time.Second)
	lockedUntil := int64(0)
	if wait > 0 {
		lockedUntil = s.now().Unix() + wait
	}
	if _, err := s.db.ExecContext(r.Context(), "UPDATE memo_passkey SET failed_count = ?, locked_until = ? WHERE user_id = ?", failed, lockedUntil, userID); err != nil {
		return false, &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save passkey", Cause: err}
	}
	slog.Warn("wrong memo passkey", slog.Int("user", int(userID)), slog.Int("failed", failed))
	return false, httphandler.JSON(w, http.StatusForbidden, map[string]any{
		"message":      "wrong passkey",
		"attemptsLeft": max(0, FreeAttempts-failed),
		"retryAfter":   wait,
	})
}

// getPasskey answers whether the caller has a passkey, its salt, and any wait before the next try.
func (s *Service) getPasskey(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	row, err := s.loadPasskey(r.Context(), user.ID)
	if err != nil {
		return err
	}
	noStore(w)
	if row == nil {
		return httphandler.JSON(w, http.StatusOK, map[string]any{"configured": false})
	}
	return httphandler.JSON(w, http.StatusOK, map[string]any{"configured": true, "salt": row.salt, "retryAfter": s.retryAfter(row)})
}

// unlockPasskey releases the caller's share for the right proof: {proof} → {share}.
// Wrong proofs answer 403 with the attempts left; past those, 429 until the wait ends.
func (s *Service) unlockPasskey(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	var body struct {
		Proof string `json:"proof"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<10)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	s.attempts.Lock()
	defer s.attempts.Unlock()
	row, err := s.loadPasskey(r.Context(), user.ID)
	if err != nil {
		return err
	}
	if row == nil {
		return &httphandler.Error{Code: http.StatusNotFound, Message: "no passkey set up"}
	}
	if ok, err := s.checkProof(w, r, user.ID, row, body.Proof); !ok {
		return err
	}
	return httphandler.JSON(w, http.StatusOK, map[string]any{"share": row.share})
}

// setPasskey sets up the passkey ({salt, proof}) or changes it ({salt, proof, currentProof}).
// A change needs the current passkey, checked with the same rate limit, and keeps the share;
// the browser re-encrypts locked memos with the new key first.
func (s *Service) setPasskey(w http.ResponseWriter, r *http.Request) error {
	user, err := s.user(r)
	if err != nil {
		return err
	}
	var body struct {
		Salt         string `json:"salt"`
		Proof        string `json:"proof"`
		CurrentProof string `json:"currentProof"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4<<10)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	_, saltOK := decodeBase64(body.Salt, 16)
	proof, proofOK := decodeBase64(body.Proof, 32)
	if !saltOK || !proofOK {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid passkey"}
	}
	ctx := r.Context()
	s.attempts.Lock()
	defer s.attempts.Unlock()
	row, err := s.loadPasskey(ctx, user.ID)
	if err != nil {
		return err
	}
	share := ""
	if row != nil {
		if ok, err := s.checkProof(w, r, user.ID, row, body.CurrentProof); !ok {
			return err
		}
		share = row.share
	} else {
		random := make([]byte, 32)
		if _, err := rand.Read(random); err != nil {
			return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to create passkey", Cause: err}
		}
		share = base64.StdEncoding.EncodeToString(random)
	}
	if _, err := s.db.ExecContext(ctx,
		`INSERT INTO memo_passkey (user_id, salt, proof_hash, share, failed_count, locked_until, updated_ts) VALUES (?, ?, ?, ?, 0, 0, ?)
		 ON CONFLICT(user_id) DO UPDATE SET salt = excluded.salt, proof_hash = excluded.proof_hash, share = excluded.share,
		   failed_count = 0, locked_until = 0, updated_ts = excluded.updated_ts`,
		user.ID, body.Salt, hashProof(proof), share, s.now().Unix()); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save passkey", Cause: err}
	}
	noStore(w)
	return httphandler.JSON(w, http.StatusOK, map[string]any{"configured": true, "share": share})
}
