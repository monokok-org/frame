export class LLMError extends Error {
    constructor(message: string, public status?: number) {
        super(message);
        this.name = 'LLMError';
    }
}
