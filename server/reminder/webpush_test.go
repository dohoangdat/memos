package reminder

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/ecdh"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/json"
	"math/big"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// decrypt is the browser's side of RFC 8291, to check what encrypt produces.
func decrypt(t *testing.T, body []byte, uaPrivate *ecdh.PrivateKey, authSecret []byte) []byte {
	t.Helper()
	salt, recordSize, idLength := body[:16], binary.BigEndian.Uint32(body[16:20]), int(body[20])
	require.Equal(t, uint32(4096), recordSize)
	asPublicRaw := body[21 : 21+idLength]
	asPublic, err := ecdh.P256().NewPublicKey(asPublicRaw)
	require.NoError(t, err)
	secret, err := uaPrivate.ECDH(asPublic)
	require.NoError(t, err)
	cek, nonce, err := deriveKeys(secret, authSecret, uaPrivate.PublicKey().Bytes(), asPublicRaw, salt)
	require.NoError(t, err)
	block, err := aes.NewCipher(cek)
	require.NoError(t, err)
	gcm, err := cipher.NewGCM(block)
	require.NoError(t, err)
	plain, err := gcm.Open(nil, nonce, body[21+idLength:], nil)
	require.NoError(t, err)
	require.Equal(t, byte(0x02), plain[len(plain)-1], "last-record delimiter")
	return plain[:len(plain)-1]
}

func TestEncryptRoundTrip(t *testing.T) {
	uaPrivate, err := ecdh.P256().GenerateKey(rand.Reader)
	require.NoError(t, err)
	authSecret := make([]byte, 16)
	_, _ = rand.Read(authSecret)
	payload := []byte(`{"title":"⏰ Nộp thuế","body":"trước 30/11"}`)
	body, err := encrypt(payload, uaPrivate.PublicKey().Bytes(), authSecret)
	require.NoError(t, err)
	require.Equal(t, payload, decrypt(t, body, uaPrivate, authSecret))
}

func TestVAPIDAuthorization(t *testing.T) {
	keys, raw, err := newVAPIDKeys()
	require.NoError(t, err)
	reloaded, err := loadVAPIDKeys(raw)
	require.NoError(t, err)
	require.Equal(t, keys.public, reloaded.public)

	header, err := keys.authorization("https://fcm.googleapis.com/fcm/send/abc", "https://dohoangdat.com", time.Unix(1_800_000_000, 0))
	require.NoError(t, err)
	require.True(t, strings.HasPrefix(header, "vapid t="))
	parts := strings.SplitN(strings.TrimPrefix(header, "vapid t="), ", k=", 2)
	token := strings.Split(parts[0], ".")
	require.Len(t, token, 3)
	claims, err := b64.DecodeString(token[1])
	require.NoError(t, err)
	var decoded map[string]any
	require.NoError(t, json.Unmarshal(claims, &decoded))
	require.Equal(t, "https://fcm.googleapis.com", decoded["aud"])
	require.Equal(t, "https://dohoangdat.com", decoded["sub"])
	signature, err := b64.DecodeString(token[2])
	require.NoError(t, err)
	digest := sha256.Sum256([]byte(token[0] + "." + token[1]))
	r, s := new(big.Int).SetBytes(signature[:32]), new(big.Int).SetBytes(signature[32:])
	require.True(t, ecdsa.Verify(&keys.private.PublicKey, digest[:], r, s), "ES256 signature verifies")
	public, err := b64.DecodeString(parts[1])
	require.NoError(t, err)
	require.Equal(t, keys.public, public)
}

func TestAdvance(t *testing.T) {
	hcm, err := time.LoadLocation("Asia/Ho_Chi_Minh")
	require.NoError(t, err)
	at := func(text string) time.Time {
		value, err := time.ParseInLocation("2006-01-02 15:04", text, hcm)
		require.NoError(t, err)
		return value
	}
	now := at("2026-11-19 10:00")
	require.Equal(t, at("2026-11-19 20:00"), advance(at("2026-11-10 20:00"), RepeatDaily, now))
	require.Equal(t, at("2026-11-24 09:00"), advance(at("2026-11-10 09:00"), RepeatWeekly, now))
	// Monthly on the 31st falls on each month's last day, and returns to the 31st.
	require.Equal(t, at("2026-11-30 08:00"), advance(at("2026-10-31 08:00"), RepeatMonthly, now))
	require.Equal(t, at("2026-12-31 08:00"), addRepeat(at("2026-11-30 08:00"), RepeatMonthly, 31))
	require.Equal(t, at("2027-02-28 08:00"), addRepeat(at("2026-02-28 08:00"), RepeatYearly, 29))
}

func TestPushEndpointAllowlist(t *testing.T) {
	for _, endpoint := range []string{
		"https://fcm.googleapis.com/fcm/send/x",
		"https://updates.push.services.mozilla.com/wpush/v2/x",
		"https://web.push.apple.com/QG",
		"https://wns2-par02p.notify.windows.com/w/?token=x",
	} {
		require.True(t, allowedPushEndpoint(endpoint), endpoint)
	}
	for _, endpoint := range []string{
		"http://fcm.googleapis.com/x",
		"https://169.254.169.254/latest",
		"https://localhost/x",
		"https://fcm.googleapis.com.evil.com/x",
		"https://user@fcm.googleapis.com/x",
	} {
		require.False(t, allowedPushEndpoint(endpoint), endpoint)
	}
}
