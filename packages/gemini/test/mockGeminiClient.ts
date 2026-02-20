import type {
  EmbedContentParameters,
  EmbedContentResponse,
  GenerateContentParameters,
  GenerateContentResponse,
} from "@google/genai";
import { mock } from "node:test";
import { setTestClient } from "../src/gemini.ts";
import { EmbedResponseTemplates } from "./embedResponse.ts";
import { ClientError, ResponseTemplates } from "./generateResponse.ts";

/**
 * A mock of the Gemini client for testing
 */
export class MockGeminiClient {
  private mockGenerate;
  private mockEmbed;

  /**
   * Mocks the `Responses.prototype.parse` method
   */
  constructor() {
    this.mockGenerate = mock.fn<
      (params: GenerateContentParameters) => Promise<GenerateContentResponse>
    >(() => Promise.resolve(ResponseTemplates["default"]!));

    this.mockEmbed = mock.fn<
      (params: EmbedContentParameters) => Promise<EmbedContentResponse>
    >(() => Promise.resolve(EmbedResponseTemplates["default"]!));

    setTestClient({
      models: {
        generateContent: this.mockGenerate,
        embedContent: this.mockEmbed,
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
   * @returns The number of times the embed mock has been called
   */
  getEmbedCallCount(): number {
    return this.mockEmbed.mock.callCount();
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
   * @returns The parameters of the last call to the embed mock
   */
  getLastEmbedCall(): EmbedContentParameters {
    const { model, contents, config } = this.mockEmbed.mock.calls.at(-1)
      ?.arguments[0] as EmbedContentParameters;
    return { model, contents, config };
  }

  /**
   * Resets the call history of the mock
   */
  resetCalls(): void {
    this.mockGenerate.mock.resetCalls();
    this.mockEmbed.mock.resetCalls();
  }

  /**
   * Mocks a single successful response
   * @param response The response to return
   */
  mockResponseOnce(response: GenerateContentResponse): void {
    this.mockGenerate.mock.mockImplementationOnce(() =>
      Promise.resolve(response),
    );
  }

  /**
   * Mocks a single successful embed response
   * @param response The response to return
   */
  mockEmbedResponseOnce(response: EmbedContentResponse): void {
    this.mockEmbed.mock.mockImplementationOnce(() => Promise.resolve(response));
  }

  /**
   * Mocks a single error response
   * @param error The error to throw
   */
  mockErrorOnce(error: ClientError): void {
    this.mockGenerate.mock.mockImplementationOnce(() => Promise.reject(error));
  }

  /**
   * Mocks a single error embed response
   * @param error The error to throw
   */
  mockEmbedErrorOnce(error: ClientError): void {
    this.mockEmbed.mock.mockImplementationOnce(() => Promise.reject(error));
  }

  /**
   * Mocks a sequence of responses or errors
   * @param responses The responses or errors to return in order
   */
  mockMany(responses: (ClientError | GenerateContentResponse)[]): void {
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i]!;
      this.mockGenerate.mock.mockImplementationOnce(
        () =>
          response instanceof ClientError
            ? Promise.reject(response)
            : Promise.resolve(response),
        i,
      );
    }
  }

  /**
   * Mocks a sequence of embed responses or errors
   * @param responses The responses or errors to return in order
   */
  mockEmbedMany(responses: (ClientError | EmbedContentResponse)[]): void {
    for (let i = 0; i < responses.length; i++) {
      const response = responses[i]!;
      this.mockEmbed.mock.mockImplementationOnce(
        () =>
          response instanceof ClientError
            ? Promise.reject(response)
            : Promise.resolve(response),
        i,
      );
    }
  }
}
