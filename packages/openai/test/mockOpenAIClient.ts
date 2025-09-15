import { mock } from "node:test";
import { APIError } from "openai";
import {
  Responses,
  type ParsedResponse,
  type ResponseCreateParams,
} from "openai/resources/responses/responses";
import { ResponseTemplates } from "./parsedResponse.ts";

/**
 * A mock of the OpenAI client for testing
 */
export class MockOpenAIClient {
  private mockParse;

  /**
   * Mocks the `Responses.prototype.parse` method
   */
  constructor() {
    this.mockParse = mock.method(
      Responses.prototype,
      "parse",
      () => Promise.resolve(ResponseTemplates["default"]) as any
    );
  }

  /**
   * @returns The number of times the mock has been called
   */
  getCallCount(): number {
    return this.mockParse.mock.callCount();
  }

  /**
   * @returns The parameters of the last call to the mock
   */
  getLastCall(): ResponseCreateParams {
    const { model, input, text, tools, reasoning } =
      this.mockParse.mock.calls.at(-1)?.arguments[0] as ResponseCreateParams;
    return { model, input, text, tools, reasoning };
  }

  /**
   * Resets the call history of the mock
   */
  resetCalls(): void {
    this.mockParse.mock.resetCalls();
  }

  /**
   * Mocks a single successful response
   * @param response The response to return
   */
  mockResponseOnce(response: ParsedResponse<unknown>): void {
    this.mockParse.mock.mockImplementationOnce(
      () => Promise.resolve(response) as any
    );
  }

  /**
   * Mocks a single error response
   * @param error The error to throw
   */
  mockErrorOnce(error: APIError): void {
    this.mockParse.mock.mockImplementationOnce(
      () => Promise.reject(error) as any
    );
  }

  /**
   * Mocks a sequence of responses or errors
   * @param responses The responses or errors to return in order
   */
  mockMany(responses: (APIError | ParsedResponse<unknown>)[]): void {
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i];
      this.mockParse.mock.mockImplementationOnce(
        () =>
          response instanceof APIError
            ? (Promise.reject(response) as any)
            : (Promise.resolve(response) as any),
        i
      );
    }
  }
}
