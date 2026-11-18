package filter

import (
	"context"
	"testing"

	"github.com/stretchr/testify/require"
)

// Fork-only: the sidebar's Starred and Most opened views select memos by uid.
func TestCompileUIDInList(t *testing.T) {
	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)
	for _, dialect := range []DialectName{DialectSQLite, DialectMySQL, DialectPostgres} {
		stmt, err := engine.CompileToStatement(context.Background(), `uid in ["abc", "def"]`, RenderOptions{Dialect: dialect})
		require.NoError(t, err, dialect)
		require.Contains(t, stmt.SQL, "uid", dialect)
		require.Equal(t, []any{"abc", "def"}, stmt.Args, dialect)

		empty, err := engine.CompileToStatement(context.Background(), `uid in []`, RenderOptions{Dialect: dialect})
		require.NoError(t, err, dialect)
		require.NotEmpty(t, empty.SQL, dialect)
	}
}

// Fork-only: the sidebar's Untagged view.
func TestCompileUntagged(t *testing.T) {
	engine, err := NewEngine(NewSchema())
	require.NoError(t, err)
	stmt, err := engine.CompileToStatement(context.Background(), `size(tags) == 0`, RenderOptions{Dialect: DialectSQLite})
	require.NoError(t, err)
	require.Contains(t, stmt.SQL, "JSON_ARRAY_LENGTH(COALESCE(")
}
