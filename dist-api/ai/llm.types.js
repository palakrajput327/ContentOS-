export class LLMConfigurationException extends Error {
    constructor(message) {
        super(message);
        this.name = "LLMConfigurationException";
    }
}
export class LLMProviderException extends Error {
    statusCode;
    isRetryable;
    constructor(message, statusCode, isRetryable = false) {
        super(message);
        this.name = "LLMProviderException";
        this.statusCode = statusCode;
        this.isRetryable = isRetryable;
    }
}
