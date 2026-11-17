package api

import "context"

// MemoRevisionRecorder, when set, is told the content a memo had before an
// UpdateMemo changed it (see server/revision). Fork-only.
var MemoRevisionRecorder func(ctx context.Context, memoUID, previousContent string)
