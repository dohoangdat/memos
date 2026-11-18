package protection

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/hex"
	"strconv"
	"strings"

	"github.com/pkg/errors"
)

// sealedPrefix marks a value protected with the pepper; values without it predate the pepper.
const sealedPrefix = "v1:"

// MinPepperLength is the shortest pepper accepted (MEMOS_LOCK_PEPPER).
const MinPepperLength = 32

// errNoPepper is answered for a sealed value while no pepper is configured.
var errNoPepper = errors.New("the passkey secret (MEMOS_LOCK_PEPPER) is not configured")

// pepper keeps the server's half of each memo key out of the database alone: the share is
// stored encrypted, and the passkey proof is stored as an HMAC, both under a secret that lives
// in the server's environment, not in the database. Someone holding a copy of the database or
// of its backups then can neither test passkeys offline nor decrypt locked memos.
//
// A nil *pepper is valid and means "not configured": new values are stored as before, and
// sealed values cannot be opened.
type pepper struct {
	aead cipher.AEAD
	mac  []byte
}

func newPepper(secret string) (*pepper, error) {
	if secret == "" {
		return nil, nil
	}
	if len(secret) < MinPepperLength {
		return nil, errors.Errorf("MEMOS_LOCK_PEPPER must be at least %d characters", MinPepperLength)
	}
	derive := func(label string) []byte {
		sum := sha256.Sum256([]byte(label + secret))
		return sum[:]
	}
	block, err := aes.NewCipher(derive("memos-lock-share:v1:"))
	if err != nil {
		return nil, errors.Wrap(err, "failed to prepare the share cipher")
	}
	aead, err := cipher.NewGCM(block)
	if err != nil {
		return nil, errors.Wrap(err, "failed to prepare the share cipher")
	}
	return &pepper{aead: aead, mac: derive("memos-lock-proof:v1:")}, nil
}

func shareContext(userID int32) []byte {
	return []byte("memo_passkey.share:" + strconv.Itoa(int(userID)))
}

// sealShare stores a share; bound to its user, so a sealed share cannot be moved to another row.
func (p *pepper) sealShare(userID int32, share string) (string, error) {
	if p == nil {
		return share, nil
	}
	nonce := make([]byte, p.aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", errors.Wrap(err, "failed to seal the share")
	}
	sealed := p.aead.Seal(nonce, nonce, []byte(share), shareContext(userID))
	return sealedPrefix + base64.StdEncoding.EncodeToString(sealed), nil
}

// openShare reads a stored share, sealed or from before the pepper.
func (p *pepper) openShare(userID int32, stored string) (string, error) {
	if !strings.HasPrefix(stored, sealedPrefix) {
		return stored, nil
	}
	if p == nil {
		return "", errNoPepper
	}
	sealed, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(stored, sealedPrefix))
	if err != nil || len(sealed) < p.aead.NonceSize() {
		return "", errors.New("the stored share is damaged")
	}
	share, err := p.aead.Open(nil, sealed[:p.aead.NonceSize()], sealed[p.aead.NonceSize():], shareContext(userID))
	if err != nil {
		return "", errors.New("the stored share does not open with this MEMOS_LOCK_PEPPER")
	}
	return string(share), nil
}

// hashProof is how a passkey proof is stored.
func (p *pepper) hashProof(proof []byte) string {
	if p == nil {
		sum := sha256.Sum256(proof)
		return hex.EncodeToString(sum[:])
	}
	mac := hmac.New(sha256.New, p.mac)
	mac.Write(proof)
	return sealedPrefix + hex.EncodeToString(mac.Sum(nil))
}

// proofMatches compares a proof with its stored form, sealed or from before the pepper.
func (p *pepper) proofMatches(proof []byte, stored string) bool {
	var expected string
	if strings.HasPrefix(stored, sealedPrefix) {
		if p == nil {
			return false
		}
		expected = p.hashProof(proof)
	} else {
		sum := sha256.Sum256(proof)
		expected = hex.EncodeToString(sum[:])
	}
	return subtle.ConstantTimeCompare([]byte(expected), []byte(stored)) == 1
}
