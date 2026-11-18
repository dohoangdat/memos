import { Input } from "@usememos/ui";
import { forwardRef } from "react";

interface PasskeyInputProps {
  value: string;
  onChange: (value: string) => void;
  /** Called once six digits are in. */
  onComplete?: (value: string) => void;
  label: string;
  disabled?: boolean;
  autoFocus?: boolean;
}

/** Six masked digits, with the numeric keypad on phones. */
export const PasskeyInput = forwardRef<HTMLInputElement, PasskeyInputProps>(
  ({ value, onChange, onComplete, label, disabled, autoFocus }, ref) => (
    <Input
      ref={ref}
      type="password"
      inputMode="numeric"
      pattern="[0-9]*"
      autoComplete="one-time-code"
      maxLength={6}
      aria-label={label}
      placeholder="••••••"
      disabled={disabled}
      autoFocus={autoFocus}
      className="text-center font-mono tracking-[0.5em]"
      value={value}
      onChange={(event) => {
        const digits = event.target.value.replace(/\D/g, "").slice(0, 6);
        onChange(digits);
        if (digits.length === 6) onComplete?.(digits);
      }}
    />
  ),
);
PasskeyInput.displayName = "PasskeyInput";
