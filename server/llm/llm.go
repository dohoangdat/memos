// Package llm runs the fork's LLM features with the AI providers configured on the instance
// (Settings → AI): their API keys stay on the server and never reach the browser.
//
//   - GET  /api/x/llm/features   which features are on (admins also get their configuration
//     and the providers to choose from);
//   - PUT  /api/x/llm/features   admins configure the features;
//   - POST /api/x/llm/suggest-tags {content} suggests tags for a memo, preferring the user's
//     existing tags.
//
// Feature settings live in a fork table created with IF NOT EXISTS (SQLite only).
package llm

import (
	"context"
	"database/sql"
	"encoding/json"
	"log/slog"
	"net/http"
	"slices"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode"

	"golang.org/x/text/unicode/norm"

	"github.com/usememos/memos/internal/httphandler"
	"github.com/usememos/memos/internal/profile"
	"github.com/usememos/memos/markdown"
	storepb "github.com/usememos/memos/proto/gen/store"
	"github.com/usememos/memos/provider/ai"
	"github.com/usememos/memos/server/auth"
	"github.com/usememos/memos/store"
)

const schema = `
CREATE TABLE IF NOT EXISTS llm_feature (
  name TEXT PRIMARY KEY,
  config TEXT NOT NULL,
  updated_ts BIGINT NOT NULL
);
`

// Features is the configuration of the LLM features.
type Features struct {
	SuggestTags SuggestTagsConfig `json:"suggestTags"`
	VoiceNote   VoiceNoteConfig   `json:"voiceNote"`
}

// SuggestTagsConfig configures tag suggestions.
type SuggestTagsConfig struct {
	Enabled    bool   `json:"enabled"`
	ProviderID string `json:"providerId"`
	Model      string `json:"model"`
	// Prompt is extra guidance added to the built-in instruction.
	Prompt string `json:"prompt"`
	// MaxTags is how many tags a suggestion holds at most (1–10).
	MaxTags int `json:"maxTags"`
	// AllowNew lets the model propose a tag the user does not have yet.
	AllowNew bool `json:"allowNew"`
}

// VoiceNoteConfig configures notes recorded from the ＋ button: transcription uses the instance's
// transcription settings; tags come from SuggestTags when AutoTags is on.
type VoiceNoteConfig struct {
	Enabled  bool `json:"enabled"`
	AutoTags bool `json:"autoTags"`
}

func defaultFeatures() Features {
	return Features{
		SuggestTags: SuggestTagsConfig{MaxTags: 3, AllowNew: true},
		VoiceNote:   VoiceNoteConfig{Enabled: true, AutoTags: true},
	}
}

// Rate limit for suggestions, per user.
const (
	suggestLimit  = 30
	suggestWindow = time.Minute
	maxContent    = 12000
)

// Service serves the LLM endpoints.
type Service struct {
	db            *sql.DB
	store         *store.Store
	authenticator *auth.Authenticator
	markdown      markdown.Service
	chat          chatFunc
	enabled       bool

	mu    sync.Mutex
	calls map[int32][]time.Time
}

// New prepares the table. A failure disables the features instead of stopping the server.
func New(ctx context.Context, p *profile.Profile, s *store.Store, secret string) *Service {
	service := &Service{
		db:            s.GetDriver().GetDB(),
		store:         s,
		authenticator: auth.NewAuthenticator(s, secret),
		markdown:      markdown.NewService(markdown.WithTagExtension()),
		chat:          chat,
		calls:         map[int32][]time.Time{},
	}
	if p.Driver != "sqlite" {
		slog.Info("LLM features are only available on sqlite; disabled", slog.String("driver", p.Driver))
		return service
	}
	if _, err := service.db.ExecContext(ctx, schema); err != nil {
		slog.Warn("LLM features disabled: failed to prepare table", slog.String("error", err.Error()))
		return service
	}
	service.enabled = true
	return service
}

// WithChat replaces the provider call; for tests.
func (s *Service) WithChat(fn func(ctx context.Context, provider ai.ProviderConfig, model, system, user string) (string, error)) *Service {
	s.chat = fn
	return s
}

// RegisterRoutes serves the LLM endpoints.
func (s *Service) RegisterRoutes(mux *http.ServeMux) {
	mux.Handle("GET /api/x/llm/features", httphandler.Func(s.getFeatures))
	mux.Handle("PUT /api/x/llm/features", httphandler.Func(s.setFeatures))
	mux.Handle("POST /api/x/llm/suggest-tags", httphandler.Func(s.suggestTags))
}

func (s *Service) caller(r *http.Request) (*store.User, error) {
	if !s.enabled {
		return nil, &httphandler.Error{Code: http.StatusNotImplemented, Message: "LLM features are not available"}
	}
	// Bearer token only, like every fork endpoint (see server/protection).
	user, err := s.authenticator.AuthenticateToUser(r.Context(), r.Header.Get("Authorization"), "")
	if err != nil || user == nil {
		return nil, &httphandler.Error{Code: http.StatusUnauthorized, Message: "authentication required"}
	}
	return user, nil
}

func (s *Service) loadFeatures(ctx context.Context) (Features, error) {
	features := defaultFeatures()
	var raw string
	err := s.db.QueryRowContext(ctx, "SELECT config FROM llm_feature WHERE name = 'features'").Scan(&raw)
	if err == sql.ErrNoRows {
		return features, nil
	}
	if err != nil {
		return features, err
	}
	_ = json.Unmarshal([]byte(raw), &features)
	return features, nil
}

func (s *Service) providers(ctx context.Context) ([]ai.ProviderConfig, *storepb.InstanceAISetting, error) {
	setting, err := s.store.GetInstanceAISetting(ctx)
	if err != nil {
		return nil, nil, err
	}
	providers := []ai.ProviderConfig{}
	for _, provider := range setting.GetProviders() {
		if provider == nil {
			continue
		}
		providerType := ai.ProviderOpenAI
		if provider.GetType() == storepb.AIProviderType_GEMINI {
			providerType = ai.ProviderGemini
		}
		providers = append(providers, ai.ProviderConfig{
			ID: provider.GetId(), Title: provider.GetTitle(), Type: providerType, Endpoint: provider.GetEndpoint(), APIKey: provider.GetApiKey(),
		})
	}
	return providers, setting, nil
}

// getFeatures answers what the features can do for the caller; admins also see the configuration.
func (s *Service) getFeatures(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	ctx := r.Context()
	features, err := s.loadFeatures(ctx)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to load LLM features", Cause: err}
	}
	providers, setting, err := s.providers(ctx)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to load AI providers", Cause: err}
	}
	suggestReady := features.SuggestTags.Enabled && slices.ContainsFunc(providers, func(p ai.ProviderConfig) bool {
		return p.ID == features.SuggestTags.ProviderID && p.APIKey != ""
	})
	transcriptionReady := setting.GetTranscription().GetProviderId() != ""
	answer := map[string]any{
		"suggestTags": suggestReady,
		"voiceNote":   features.VoiceNote.Enabled,
		"voiceTags":   features.VoiceNote.Enabled && features.VoiceNote.AutoTags && suggestReady,
		"transcribe":  transcriptionReady,
	}
	if user.Role == store.RoleAdmin {
		choices := []map[string]any{}
		for _, provider := range providers {
			choices = append(choices, map[string]any{"id": provider.ID, "title": provider.Title, "type": string(provider.Type), "keySet": provider.APIKey != ""})
		}
		answer["config"] = features
		answer["providers"] = choices
	}
	w.Header().Set("Cache-Control", "private, no-store")
	return httphandler.JSON(w, http.StatusOK, answer)
}

// setFeatures stores the configuration; admins only.
func (s *Service) setFeatures(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	if user.Role != store.RoleAdmin {
		return &httphandler.Error{Code: http.StatusForbidden, Message: "only admins configure LLM features"}
	}
	var features Features
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 16<<10)).Decode(&features); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	features.SuggestTags.MaxTags = min(max(features.SuggestTags.MaxTags, 1), 10)
	features.SuggestTags.Model = strings.TrimSpace(features.SuggestTags.Model)
	if len(features.SuggestTags.Prompt) > 2000 || len(features.SuggestTags.Model) > 200 {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "prompt or model too long"}
	}
	raw, err := json.Marshal(features)
	if err != nil {
		return err
	}
	if _, err := s.db.ExecContext(r.Context(),
		`INSERT INTO llm_feature (name, config, updated_ts) VALUES ('features', ?, ?)
		 ON CONFLICT(name) DO UPDATE SET config = excluded.config, updated_ts = excluded.updated_ts`,
		string(raw), time.Now().Unix()); err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to save LLM features", Cause: err}
	}
	return httphandler.JSON(w, http.StatusOK, features)
}

// allow counts one suggestion against the caller's budget.
func (s *Service) allow(userID int32) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	now := time.Now()
	recent := s.calls[userID][:0]
	for _, at := range s.calls[userID] {
		if now.Sub(at) < suggestWindow {
			recent = append(recent, at)
		}
	}
	if len(recent) >= suggestLimit {
		s.calls[userID] = recent
		return false
	}
	s.calls[userID] = append(recent, now)
	return true
}

// userTags is the caller's tags, most used first.
func (s *Service) userTags(ctx context.Context, userID int32) ([]string, error) {
	memos, err := s.store.ListMemos(ctx, &store.FindMemo{CreatorID: &userID, ExcludeContent: true})
	if err != nil {
		return nil, err
	}
	counts := map[string]int{}
	for _, memo := range memos {
		if memo.Payload == nil {
			continue
		}
		for _, tag := range memo.Payload.Tags {
			counts[tag]++
		}
	}
	tags := make([]string, 0, len(counts))
	for tag := range counts {
		tags = append(tags, tag)
	}
	sort.Slice(tags, func(i, j int) bool {
		if counts[tags[i]] != counts[tags[j]] {
			return counts[tags[i]] > counts[tags[j]]
		}
		return tags[i] < tags[j]
	})
	return tags, nil
}

const suggestInstruction = `You tag notes in a personal note app. Choose the tags that best describe the note.
Rules:
- Use the user's existing tags first: pick from the list, spelled exactly as listed (they may be hierarchical like "parent/child"). Most-used tags come first in the list.
- A tag that means the same as an existing one (a synonym, translation, plural, other spelling) is the existing one: answer with the existing spelling.
- Pick the most specific fitting tag; do not add a parent when you add its child.
- Return at most %d tags, ordered by relevance. Return fewer when few fit; return none if nothing fits.
- %s
- Answer only with JSON: {"tags": ["tag", ...]} without the leading '#'.`

// suggestTags answers {tags: [{tag, existing}]} for {content}.
func (s *Service) suggestTags(w http.ResponseWriter, r *http.Request) error {
	user, err := s.caller(r)
	if err != nil {
		return err
	}
	var body struct {
		Content string `json:"content"`
	}
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&body); err != nil {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "invalid body"}
	}
	content := strings.TrimSpace(body.Content)
	if content == "" {
		return &httphandler.Error{Code: http.StatusBadRequest, Message: "the memo is empty"}
	}
	if len(content) > maxContent {
		content = content[:maxContent]
	}
	ctx := r.Context()
	features, err := s.loadFeatures(ctx)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to load LLM features", Cause: err}
	}
	config := features.SuggestTags
	if !config.Enabled {
		return &httphandler.Error{Code: http.StatusFailedDependency, Message: "tag suggestions are turned off"}
	}
	providers, _, err := s.providers(ctx)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to load AI providers", Cause: err}
	}
	provider, err := ai.FindProvider(providers, config.ProviderID)
	if err != nil {
		return &httphandler.Error{Code: http.StatusFailedDependency, Message: "the provider for tag suggestions is not configured"}
	}
	if !s.allow(user.ID) {
		return &httphandler.Error{Code: http.StatusTooManyRequests, Message: "too many suggestions; try again in a minute"}
	}
	existing, err := s.userTags(ctx, user.ID)
	if err != nil {
		return &httphandler.Error{Code: http.StatusInternalServerError, Message: "failed to list tags", Cause: err}
	}
	if len(existing) > 400 {
		existing = existing[:400]
	}
	newRule := "Only use tags from the existing list."
	if config.AllowNew {
		newRule = "Only when no existing tag fits a clear topic of the note, you may add one new tag in the style of the existing ones; never propose a new tag close to an existing one."
	}
	system := strings.Replace(strings.Replace(suggestInstruction, "%d", strconv.Itoa(config.MaxTags), 1), "%s", newRule, 1)
	if extra := strings.TrimSpace(config.Prompt); extra != "" {
		system += "\nAdditional guidance from the owner:\n" + extra
	}
	userMessage := "Existing tags:\n" + strings.Join(existing, "\n") + "\n\nNote:\n" + content
	answer, err := s.chat(ctx, *provider, config.Model, system, userMessage)
	if err != nil {
		slog.Warn("tag suggestion failed", slog.String("error", err.Error()))
		return &httphandler.Error{Code: http.StatusBadGateway, Message: "the AI provider did not answer", Cause: err}
	}
	tags := s.parseTags(answer, existing, config)
	w.Header().Set("Cache-Control", "private, no-store")
	return httphandler.JSON(w, http.StatusOK, map[string]any{"tags": tags})
}

type suggestion struct {
	Tag      string `json:"tag"`
	Existing bool   `json:"existing"`
}

// parseTags reads the model's answer, keeping valid tags only, at most MaxTags, and dropping a
// parent when its child is suggested.
func (s *Service) parseTags(answer string, existing []string, config SuggestTagsConfig) []suggestion {
	var parsed struct {
		Tags []string `json:"tags"`
	}
	answer = strings.TrimSpace(answer)
	if start, end := strings.Index(answer, "{"), strings.LastIndex(answer, "}"); start >= 0 && end > start {
		answer = answer[start : end+1]
	}
	if err := json.Unmarshal([]byte(answer), &parsed); err != nil {
		return []suggestion{}
	}
	known := map[string]bool{}
	canonical := map[string]string{}
	// A new tag that only differs from an existing one in case, punctuation or accents, or that
	// names an existing tag's last part ("hermes" for "work/hermes"), is that existing tag.
	loose := map[string]string{}
	leaf := map[string]string{}
	leafCount := map[string]int{}
	for _, tag := range existing {
		known[strings.ToLower(tag)] = true
		canonical[strings.ToLower(tag)] = tag
		if _, ok := loose[looseKey(tag)]; !ok {
			loose[looseKey(tag)] = tag
		}
		last := looseKey(tag[strings.LastIndex(tag, "/")+1:])
		leafCount[last]++
		if _, ok := leaf[last]; !ok {
			leaf[last] = tag
		}
	}
	picked := []string{}
	for _, raw := range parsed.Tags {
		tag := strings.Trim(strings.TrimSpace(strings.TrimPrefix(strings.TrimSpace(raw), "#")), "/")
		if tag == "" {
			continue
		}
		if exact, ok := canonical[strings.ToLower(tag)]; ok {
			tag = exact
		} else if match, ok := loose[looseKey(tag)]; ok {
			tag = match
		} else if match, ok := leaf[looseKey(tag)]; ok && leafCount[looseKey(tag)] == 1 {
			tag = match
		} else if !config.AllowNew {
			continue
		}
		if !s.isTag(tag) || slices.Contains(picked, tag) {
			continue
		}
		picked = append(picked, tag)
	}
	// Existing tags come first; at most one new tag, and only after them.
	existingFirst := []string{}
	newTags := []string{}
	for _, tag := range picked {
		if known[strings.ToLower(tag)] {
			existingFirst = append(existingFirst, tag)
		} else if len(newTags) == 0 {
			newTags = append(newTags, tag)
		}
	}
	picked = append(existingFirst, newTags...)
	result := []suggestion{}
	for _, tag := range picked {
		if slices.ContainsFunc(picked, func(other string) bool { return strings.HasPrefix(other, tag+"/") }) {
			continue
		}
		result = append(result, suggestion{Tag: tag, Existing: known[strings.ToLower(tag)]})
		if len(result) >= config.MaxTags {
			break
		}
	}
	return result
}

// looseKey folds case, Vietnamese/Latin accents and separators, so "Công-Việc" and "cong_viec"
// compare equal.
func looseKey(tag string) string {
	var b strings.Builder
	for _, r := range norm.NFD.String(strings.ToLower(tag)) {
		switch {
		case unicode.Is(unicode.Mn, r), r == '-', r == '_', r == ' ', r == '.':
			continue
		case r == 'đ':
			b.WriteRune('d')
		default:
			b.WriteRune(r)
		}
	}
	return b.String()
}

func (s *Service) isTag(tag string) bool {
	if strings.ContainsAny(tag, " \t\n") {
		return false
	}
	tags, err := s.markdown.ExtractTags([]byte("#" + tag))
	return err == nil && slices.Contains(tags, tag)
}
