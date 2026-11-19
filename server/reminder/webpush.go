package reminder

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/hkdf"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"github.com/pkg/errors"
)

// Web Push (RFC 8030) with message encryption (RFC 8291, aes128gcm) and VAPID (RFC 8292),
// on the standard library only.

var b64 = base64.RawURLEncoding

// decodeKey reads a base64url (or standard base64) key as browsers send it.
func decodeKey(value string) ([]byte, error) {
	for _, encoding := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.StdEncoding} {
		if decoded, err := encoding.DecodeString(value); err == nil {
			return decoded, nil
		}
	}
	return nil, errors.New("invalid base64 key")
}

// vapidKeys is the server's application server key pair.
type vapidKeys struct {
	private *ecdsa.PrivateKey
	// public is the uncompressed P-256 point browsers subscribe with.
	public []byte
}

func newVAPIDKeys() (*vapidKeys, []byte, error) {
	key, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, nil, err
	}
	keys, err := loadVAPIDKeys(key.Bytes())
	return keys, key.Bytes(), err
}

func loadVAPIDKeys(raw []byte) (*vapidKeys, error) {
	private, err := ecdsa.ParseRawPrivateKey(elliptic.P256(), raw)
	if err != nil {
		return nil, errors.Wrap(err, "invalid VAPID private key")
	}
	public, err := private.PublicKey.Bytes()
	if err != nil {
		return nil, err
	}
	return &vapidKeys{private: private, public: public}, nil
}

// authorization is the VAPID Authorization header for a push service origin.
func (k *vapidKeys) authorization(endpoint, subject string, now time.Time) (string, error) {
	parsed, err := url.Parse(endpoint)
	if err != nil {
		return "", err
	}
	header := b64.EncodeToString([]byte(`{"typ":"JWT","alg":"ES256"}`))
	claims, err := json.Marshal(map[string]any{
		"aud": parsed.Scheme + "://" + parsed.Host,
		"exp": now.Add(12 * time.Hour).Unix(),
		"sub": subject,
	})
	if err != nil {
		return "", err
	}
	signingInput := header + "." + b64.EncodeToString(claims)
	digest := sha256.Sum256([]byte(signingInput))
	r, s, err := ecdsa.Sign(rand.Reader, k.private, digest[:])
	if err != nil {
		return "", err
	}
	signature := make([]byte, 64)
	r.FillBytes(signature[:32])
	s.FillBytes(signature[32:])
	return fmt.Sprintf("vapid t=%s.%s, k=%s", signingInput, b64.EncodeToString(signature), b64.EncodeToString(k.public)), nil
}

// encrypt seals a payload for one subscription (RFC 8291, a single aes128gcm record).
func encrypt(payload, uaPublicRaw, authSecret []byte) ([]byte, error) {
	uaPublic, err := ecdh.P256().NewPublicKey(uaPublicRaw)
	if err != nil {
		return nil, errors.Wrap(err, "invalid subscription key")
	}
	asPrivate, err := ecdh.P256().GenerateKey(rand.Reader)
	if err != nil {
		return nil, err
	}
	asPublic := asPrivate.PublicKey().Bytes()
	secret, err := asPrivate.ECDH(uaPublic)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return nil, err
	}
	return seal(payload, secret, authSecret, uaPublicRaw, asPublic, salt)
}

func deriveKeys(secret, authSecret, uaPublic, asPublic, salt []byte) (cek, nonce []byte, err error) {
	prkKey, err := hkdf.Extract(sha256.New, secret, authSecret)
	if err != nil {
		return nil, nil, err
	}
	keyInfo := "WebPush: info\x00" + string(uaPublic) + string(asPublic)
	ikm, err := hkdf.Expand(sha256.New, prkKey, keyInfo, 32)
	if err != nil {
		return nil, nil, err
	}
	prk, err := hkdf.Extract(sha256.New, ikm, salt)
	if err != nil {
		return nil, nil, err
	}
	if cek, err = hkdf.Expand(sha256.New, prk, "Content-Encoding: aes128gcm\x00", 16); err != nil {
		return nil, nil, err
	}
	nonce, err = hkdf.Expand(sha256.New, prk, "Content-Encoding: nonce\x00", 12)
	return cek, nonce, err
}

func seal(payload, secret, authSecret, uaPublic, asPublic, salt []byte) ([]byte, error) {
	cek, nonce, err := deriveKeys(secret, authSecret, uaPublic, asPublic, salt)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(cek)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	// One record: the payload, then the 0x02 delimiter of a last record.
	plaintext := append(append([]byte{}, payload...), 0x02)
	var body bytes.Buffer
	body.Write(salt)
	_ = binary.Write(&body, binary.BigEndian, uint32(4096))
	body.WriteByte(byte(len(asPublic)))
	body.Write(asPublic)
	body.Write(gcm.Seal(nil, nonce, plaintext, nil))
	return body.Bytes(), nil
}

// errGone marks a subscription the push service no longer knows; it is deleted.
var errGone = errors.New("push subscription expired")

// send delivers one encrypted message to a subscription.
func send(ctx context.Context, client *http.Client, keys *vapidKeys, subject string, sub subscription, payload []byte, ttl time.Duration) error {
	p256dh, err := decodeKey(sub.P256dh)
	if err != nil {
		return err
	}
	auth, err := decodeKey(sub.Auth)
	if err != nil {
		return err
	}
	body, err := encrypt(payload, p256dh, auth)
	if err != nil {
		return err
	}
	authorization, err := keys.authorization(sub.Endpoint, subject, time.Now())
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, sub.Endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Content-Encoding", "aes128gcm")
	request.Header.Set("Content-Type", "application/octet-stream")
	request.Header.Set("TTL", fmt.Sprint(int(ttl.Seconds())))
	request.Header.Set("Urgency", "high")
	request.Header.Set("Authorization", authorization)
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	detail, _ := io.ReadAll(io.LimitReader(response.Body, 512))
	switch {
	case response.StatusCode == http.StatusNotFound || response.StatusCode == http.StatusGone:
		return errGone
	case response.StatusCode >= 300:
		return errors.Errorf("push service answered %d: %s", response.StatusCode, bytes.TrimSpace(detail))
	}
	return nil
}
