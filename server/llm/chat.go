package llm

import (
	"context"
	"net/http"
	"strings"
	"time"

	openaisdk "github.com/openai/openai-go/v3"
	openaioption "github.com/openai/openai-go/v3/option"
	"github.com/pkg/errors"
	"google.golang.org/genai"

	"github.com/usememos/memos/provider/ai"
)

const (
	defaultOpenAIModel    = "gpt-4o-mini"
	defaultGeminiModel    = "gemini-2.5-flash"
	defaultOpenAIEndpoint = "https://api.openai.com/v1"
	chatTimeout           = 45 * time.Second
)

// chatFunc asks a provider one question: a system instruction and a user message, answered as text.
type chatFunc func(ctx context.Context, provider ai.ProviderConfig, model, system, user string) (string, error)

// chat sends one request to an OpenAI-compatible or Gemini provider, asking for JSON back.
func chat(ctx context.Context, provider ai.ProviderConfig, model, system, user string) (string, error) {
	if provider.APIKey == "" {
		return "", errors.New("the provider has no API key")
	}
	ctx, cancel := context.WithTimeout(ctx, chatTimeout)
	defer cancel()
	httpClient := &http.Client{Timeout: chatTimeout}
	switch provider.Type {
	case ai.ProviderOpenAI:
		endpoint := strings.TrimRight(strings.TrimSpace(provider.Endpoint), "/")
		if endpoint == "" {
			endpoint = defaultOpenAIEndpoint
		}
		if model == "" {
			model = defaultOpenAIModel
		}
		client := openaisdk.NewClient(
			openaioption.WithAPIKey(provider.APIKey),
			openaioption.WithBaseURL(endpoint),
			openaioption.WithHTTPClient(httpClient),
		)
		completion, err := client.Chat.Completions.New(ctx, openaisdk.ChatCompletionNewParams{
			Model: model,
			Messages: []openaisdk.ChatCompletionMessageParamUnion{
				openaisdk.SystemMessage(system),
				openaisdk.UserMessage(user),
			},
			ResponseFormat: openaisdk.ChatCompletionNewParamsResponseFormatUnion{
				OfJSONObject: &openaisdk.ResponseFormatJSONObjectParam{},
			},
		})
		if err != nil {
			return "", errors.Wrap(err, "OpenAI request failed")
		}
		if len(completion.Choices) == 0 {
			return "", errors.New("OpenAI returned no answer")
		}
		return completion.Choices[0].Message.Content, nil
	case ai.ProviderGemini:
		if model == "" {
			model = defaultGeminiModel
		}
		options := genai.HTTPOptions{}
		if endpoint := strings.TrimSpace(provider.Endpoint); endpoint != "" {
			options.BaseURL = endpoint
		}
		client, err := genai.NewClient(ctx, &genai.ClientConfig{
			APIKey:      provider.APIKey,
			Backend:     genai.BackendGeminiAPI,
			HTTPClient:  httpClient,
			HTTPOptions: options,
		})
		if err != nil {
			return "", errors.Wrap(err, "failed to create the Gemini client")
		}
		resp, err := client.Models.GenerateContent(ctx, strings.TrimPrefix(model, "models/"), genai.Text(user), &genai.GenerateContentConfig{
			SystemInstruction: genai.NewContentFromText(system, genai.RoleUser),
			ResponseMIMEType:  "application/json",
		})
		if err != nil {
			return "", errors.Wrap(err, "Gemini request failed")
		}
		return resp.Text(), nil
	default:
		return "", errors.Errorf("unsupported provider type %q", provider.Type)
	}
}
