import { useState, useRef, useEffect, useId } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

export interface Country {
  code: string;
  name: string;
  dialCode: string;
  flag: string;
  format: string;
  sample: string;
  minDigits: number;
  maxDigits: number;
}

export const COUNTRIES: Country[] = [
  { code: "IN", name: "India", dialCode: "+91", flag: "🇮🇳", format: "##### #####", sample: "98765 43210", minDigits: 10, maxDigits: 10 },
  { code: "US", name: "United States", dialCode: "+1", flag: "🇺🇸", format: "(###) ###-####", sample: "(555) 012-3456", minDigits: 10, maxDigits: 10 },
  { code: "GB", name: "United Kingdom", dialCode: "+44", flag: "🇬🇧", format: "#### ######", sample: "7911 123456", minDigits: 10, maxDigits: 11 },
  { code: "AE", name: "United Arab Emirates", dialCode: "+971", flag: "🇦🇪", format: "## ### ####", sample: "50 123 4567", minDigits: 9, maxDigits: 9 },
  { code: "CA", name: "Canada", dialCode: "+1", flag: "🇨🇦", format: "(###) ###-####", sample: "(555) 012-3456", minDigits: 10, maxDigits: 10 },
  { code: "AU", name: "Australia", dialCode: "+61", flag: "🇦🇺", format: "### ### ###", sample: "412 345 678", minDigits: 9, maxDigits: 10 },
  { code: "SG", name: "Singapore", dialCode: "+65", flag: "🇸🇬", format: "#### ####", sample: "8123 4567", minDigits: 8, maxDigits: 8 },
  { code: "DE", name: "Germany", dialCode: "+49", flag: "🇩🇪", format: "#### #######", sample: "1512 3456789", minDigits: 10, maxDigits: 11 },
  { code: "FR", name: "France", dialCode: "+33", flag: "🇫🇷", format: "# ## ## ## ##", sample: "6 12 34 56 78", minDigits: 9, maxDigits: 9 },
  { code: "SA", name: "Saudi Arabia", dialCode: "+966", flag: "🇸🇦", format: "## ### ####", sample: "50 123 4567", minDigits: 9, maxDigits: 9 },
  { code: "MY", name: "Malaysia", dialCode: "+60", flag: "🇲🇾", format: "##-### ####", sample: "12-345 6789", minDigits: 9, maxDigits: 10 },
  { code: "NZ", name: "New Zealand", dialCode: "+64", flag: "🇳🇿", format: "### ### ####", sample: "211 234 567", minDigits: 8, maxDigits: 10 },
  { code: "ZA", name: "South Africa", dialCode: "+27", flag: "🇿🇦", format: "## ### ####", sample: "82 123 4567", minDigits: 9, maxDigits: 9 },
  { code: "JP", name: "Japan", dialCode: "+81", flag: "🇯🇵", format: "##-####-####", sample: "90-1234-5678", minDigits: 10, maxDigits: 10 },
  { code: "BR", name: "Brazil", dialCode: "+55", flag: "🇧🇷", format: "## #####-####", sample: "11 98765-4321", minDigits: 10, maxDigits: 11 },
];

export interface PhoneInputProps {
  value?: string;
  countryCode?: string;
  onChange?: (e164: string, country: Country) => void;
  disabled?: boolean;
  required?: boolean;
  className?: string;
  id?: string;
}

export function PhoneInput({
  value = "",
  countryCode = "IN",
  onChange,
  disabled = false,
  required = false,
  className = "",
  id,
}: PhoneInputProps) {
  const generatedId = useId();
  const inputId = id || generatedId;

  const defaultCountry = COUNTRIES.find((c) => c.code === countryCode) || COUNTRIES[0];
  const [selectedCountry, setSelectedCountry] = useState<Country>(defaultCountry);
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const [rawNumber, setRawNumber] = useState(() => {
    if (value && value.startsWith(selectedCountry.dialCode)) {
      return value.slice(selectedCountry.dialCode.length);
    }
    return value.replace(/^\+/, "");
  });

  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Sync incoming value
  useEffect(() => {
    if (!value) {
      setRawNumber("");
      return;
    }
    const matched = COUNTRIES.find((c) => value.startsWith(c.dialCode));
    if (matched) {
      setSelectedCountry(matched);
      setRawNumber(value.slice(matched.dialCode.length).trim());
    } else {
      setRawNumber(value.replace(/^\+/, "").trim());
    }
  }, [value]);

  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    } else {
      setSearch("");
    }
  }, [open]);

  // Click outside listener
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleClick);
    }
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filteredCountries = COUNTRIES.filter(
    (c) =>
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.dialCode.includes(search) ||
      c.code.toLowerCase().includes(search.toLowerCase()),
  );

  function handleNumberChange(e: React.ChangeEvent<HTMLInputElement>) {
    const digitsOnly = e.target.value.replace(/\D/g, "").slice(0, selectedCountry.maxDigits);
    setRawNumber(digitsOnly);
    const e164 = digitsOnly ? `${selectedCountry.dialCode}${digitsOnly}` : "";
    onChange?.(e164, selectedCountry);
  }

  function handleSelectCountry(c: Country) {
    setSelectedCountry(c);
    setOpen(false);
    const e164 = rawNumber ? `${c.dialCode}${rawNumber}` : "";
    onChange?.(e164, c);
  }

  return (
    <div className={`phone-input-root ${className}`}>
      <div className="phone-input-container">
        {/* Country Selector Dropdown Trigger */}
        <div className="phone-country-select-wrapper" ref={dropdownRef}>
          <button
            type="button"
            className="phone-country-trigger"
            onClick={() => !disabled && setOpen(!open)}
            disabled={disabled}
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-label={`Select country code, current is ${selectedCountry.name} (${selectedCountry.dialCode})`}
          >
            <span className="country-flag">{selectedCountry.flag}</span>
            <span className="country-code-text">{selectedCountry.dialCode}</span>
            <ChevronDown size={14} className={`dropdown-chevron ${open ? "rotated" : ""}`} />
          </button>

          {/* Country Dropdown Panel */}
          {open && (
            <div className="phone-dropdown-menu" role="listbox">
              <div className="dropdown-search-wrapper">
                <Search size={14} className="search-icon" />
                <input
                  ref={searchInputRef}
                  type="text"
                  placeholder="Search country or code..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="dropdown-search-input"
                  aria-label="Search countries"
                />
              </div>
              <div className="countries-list">
                {filteredCountries.length === 0 ? (
                  <div className="dropdown-empty">No country matches</div>
                ) : (
                  filteredCountries.map((c) => {
                    const isSelected = c.code === selectedCountry.code;
                    return (
                      <button
                        key={c.code}
                        type="button"
                        role="option"
                        aria-selected={isSelected}
                        className={`country-option-item ${isSelected ? "selected" : ""}`}
                        onClick={() => handleSelectCountry(c)}
                      >
                        <span className="country-flag">{c.flag}</span>
                        <span className="country-name-text">{c.name}</span>
                        <span className="country-dial-text">{c.dialCode}</span>
                        {isSelected && <Check size={14} className="check-icon" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>

        {/* Local Number Input */}
        <input
          id={inputId}
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={selectedCountry.sample}
          value={rawNumber}
          onChange={handleNumberChange}
          disabled={disabled}
          required={required}
          className="phone-number-input"
        />
      </div>
      <div className="phone-helper-text">
        <small>Standard international E.164 format ({selectedCountry.dialCode})</small>
      </div>
    </div>
  );
}
