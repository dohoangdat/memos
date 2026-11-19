package markdown

import (
	"bytes"
	"strings"

	gast "github.com/yuin/goldmark/ast"
)

// RenameTagTree renames a tag and every tag under it in one pass: with from "a" and to "b",
// #a becomes #b and #a/x becomes #b/x, while #ab and tags in code stay as they are. It reports
// whether anything changed. Fork-only (server/tagrename), in its own file to keep merges clean.
func RenameTagTree(content []byte, from, to string) (string, bool, error) {
	return rewriteTagTree(content, from, func(tag string) string { return "#" + to + tag[len(from):] })
}

// RemoveTagTree removes a tag and every tag under it, with the space before each, from the
// memo's text (outside code), reporting whether anything changed. Fork-only (server/tagrename).
func RemoveTagTree(content []byte, tag string) (string, bool, error) {
	return rewriteTagTree(content, tag, func(string) string { return "" })
}

// rewriteTagTree replaces each `#tag` source span under `root` with what replace returns; an
// empty replacement also drops one space or tab right before the tag.
func rewriteTagTree(content []byte, from string, replace func(tag string) string) (string, bool, error) {
	s, ok := NewService(WithTagExtension()).(*service)
	if !ok {
		return string(content), false, nil
	}
	root, err := s.parse(content)
	if err != nil {
		return "", false, err
	}
	type replacement struct {
		start, end int
		tag        string
	}
	var replacements []replacement
	err = gast.Walk(root, func(n gast.Node, entering bool) (gast.WalkStatus, error) {
		if !entering {
			return gast.WalkContinue, nil
		}
		tagNode, ok := asMemoTagNode(n)
		if !ok || len(tagNode.Source) == 0 {
			return gast.WalkContinue, nil
		}
		tag := string(tagNode.Tag)
		if tag == from || strings.HasPrefix(tag, from+"/") {
			replacements = append(replacements, replacement{tagNode.Pos(), tagNode.Pos() + len(tagNode.Source), replace(tag)})
		}
		return gast.WalkContinue, nil
	})
	if err != nil {
		return "", false, err
	}
	if len(replacements) == 0 {
		return string(content), false, nil
	}
	// The walk visits the document in order, so the ranges are already sorted.
	var output bytes.Buffer
	output.Grow(len(content))
	cursor := 0
	for _, r := range replacements {
		start := r.start
		if r.tag == "" && start > cursor && (content[start-1] == ' ' || content[start-1] == '\t') {
			start--
		}
		output.Write(content[cursor:start])
		output.WriteString(r.tag)
		cursor = r.end
	}
	output.Write(content[cursor:])
	return output.String(), true, nil
}
