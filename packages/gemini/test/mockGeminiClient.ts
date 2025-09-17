import type {
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import { mock } from "node:test";
import { setTestClient } from "../src/gemini.ts";
import { ClientError, ResponseTemplates } from "./generateResponse.ts";

/**
 * A mock of the Gemini client for testing
 */
export class MockGeminiClient {
  private mockGenerate;

  /**
   * Mocks the `Responses.prototype.parse` method
   */
  constructor() {
    this.mockGenerate = mock.fn<
      (params: GenerateContentParameters) => Promise<GenerateContentResponse>
    >(() => Promise.resolve(ResponseTemplates["default"]!));
    setTestClient({
      models: {
        generateContent: this.mockGenerate,
      },
    });
  }

  /**
   * @returns The number of times the mock has been called
   */
  getCallCount(): number {
    return this.mockGenerate.mock.callCount();
  }

  /**
   * @returns The parameters of the last call to the mock
   */
  getLastCall(): GenerateContentParameters {
    const { model, contents, config } = this.mockGenerate.mock.calls.at(-1)
      ?.arguments[0] as GenerateContentParameters;
    return { model, contents, config };
  }

  /**
   * Resets the call history of the mock
   */
  resetCalls(): void {
    this.mockGenerate.mock.resetCalls();
  }

  /**
   * Mocks a single successful response
   * @param response The response to return
   */
  mockResponseOnce(response: GenerateContentResponse): void {
    this.mockGenerate.mock.mockImplementationOnce(
      () => Promise.resolve(response) as any
    );
  }

  /**
   * Mocks a single error response
   * @param error The error to throw
   */
  mockErrorOnce(error: ClientError): void {
    this.mockGenerate.mock.mockImplementationOnce(
      () => Promise.reject(error) as any
    );
  }

  /**
   * Mocks a sequence of responses or errors
   * @param responses The responses or errors to return in order
   */
  mockMany(responses: (ClientError | GenerateContentResponse)[]): void {
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      this.mockGenerate.mock.mockImplementationOnce(
        () =>
          response instanceof ClientError
            ? (Promise.reject(response) as any)
            : (Promise.resolve(response) as any),
        i
      );
    }
  }
}
