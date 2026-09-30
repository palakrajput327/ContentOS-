import { forwardRef, useId, useState, type InputHTMLAttributes } from "react";
import { Eye, EyeOff } from "lucide-react";
import "./password-input.css";

export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PasswordInput({ id, disabled, ...props }, ref) {
    const generatedId = useId();
    const [visible, setVisible] = useState(false);
    const inputId = id || generatedId;
    return (
      <span className="password-field">
        <input {...props} id={inputId} ref={ref} disabled={disabled} type={visible ? "text" : "password"} />
        <button className="password-toggle" type="button" disabled={disabled}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-controls={inputId} aria-pressed={visible}
          onClick={() => setVisible(value => !value)}>
          {visible ? <EyeOff size={19} aria-hidden="true" /> : <Eye size={19} aria-hidden="true" />}
        </button>
      </span>
    );
  },
);
