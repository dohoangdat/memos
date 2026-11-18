package markdown

import (
	"testing"

	"github.com/stretchr/testify/require"
)

func TestRenameTagTree(t *testing.T) {
	cases := []struct {
		name, content, from, to, want string
		changed                       bool
	}{
		{"tag and children", "#a and #a/x/y, not #ab", "a", "b", "#b and #b/x/y, not #ab", true},
		{"into its own child", "#a #a/c", "a", "a/c", "#a/c #a/c/c", true},
		{"code untouched", "`#a` and\n\n```\n#a\n```\n\n#a", "a", "z", "`#a` and\n\n```\n#a\n```\n\n#z", true},
		{"lock line", "# T\n\n🔒 #a/x #k\n\n```memos-lock\nAAAA\n```", "a", "n", "# T\n\n🔒 #n/x #k\n\n```memos-lock\nAAAA\n```", true},
		{"nothing to do", "#b", "a", "c", "#b", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			got, changed, err := RenameTagTree([]byte(c.content), c.from, c.to)
			require.NoError(t, err)
			require.Equal(t, c.want, got)
			require.Equal(t, c.changed, changed)
		})
	}
}
