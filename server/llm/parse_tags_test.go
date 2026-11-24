package llm

import (
	"testing"

	"github.com/usememos/memos/markdown"
)

func TestParseTagsPrefersExisting(t *testing.T) {
	s := &Service{markdown: markdown.NewService(markdown.WithTagExtension())}
	existing := []string{"Working/hermes", "công-việc", "travel"}
	config := SuggestTagsConfig{MaxTags: 5, AllowNew: true}
	got := s.parseTags(`{"tags":["brand-new","hermes","Cong_Viec","another-new","Travel"]}`, existing, config)
	want := []suggestion{{"Working/hermes", true}, {"công-việc", true}, {"travel", true}, {"brand-new", false}}
	if len(got) != len(want) {
		t.Fatalf("got %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("got %v, want %v", got, want)
		}
	}
	if got := s.parseTags(`{"tags":["brand-new"]}`, existing, SuggestTagsConfig{MaxTags: 5}); len(got) != 0 {
		t.Fatalf("new tag kept without AllowNew: %v", got)
	}
}
