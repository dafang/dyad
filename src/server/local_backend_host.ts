import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import type { IpcContract } from "@/ipc/contracts/core";

export type TypedBackendTransport = "electron" | "local-http" | "test";

export interface TypedBackendInvocationContext<TNativeContext = unknown> {
  channel: string;
  transport: TypedBackendTransport;
  native?: TNativeContext;
}

export type TypedBackendHandler<TInput, TOutput, TNativeContext = unknown> = (
  context: TypedBackendInvocationContext<TNativeContext>,
  input: TInput,
) => Promise<TOutput> | TOutput;

export type TypedBackendOutputValidation =
  | "throw"
  | "development-warn"
  | "none";

export interface TypedBackendHandlerErrorContext {
  channel: string;
  transport: TypedBackendTransport;
}

export interface TypedBackendValidationErrorContext {
  channel: string;
  transport: TypedBackendTransport;
}

export interface TypedBackendRegistryOptions {
  outputValidation?: TypedBackendOutputValidation;
  warn?: (message: string) => void;
  onHandlerError?: (
    error: unknown,
    context: TypedBackendHandlerErrorContext,
  ) => void;
  onValidationError?: (
    error: DyadError,
    context: TypedBackendValidationErrorContext,
  ) => void;
}

export interface RegisteredTypedBackendContract {
  channel: string;
  input: z.ZodType;
  output: z.ZodType;
}

interface RegisteredTypedBackendHandler extends RegisteredTypedBackendContract {
  handle: TypedBackendHandler<unknown, unknown>;
}

export class TypedBackendRegistry {
  private readonly handlers = new Map<string, RegisteredTypedBackendHandler>();
  private readonly options: Required<
    Pick<TypedBackendRegistryOptions, "outputValidation" | "warn">
  > &
    Pick<TypedBackendRegistryOptions, "onHandlerError" | "onValidationError">;

  constructor(options: TypedBackendRegistryOptions = {}) {
    this.options = {
      outputValidation: options.outputValidation ?? "throw",
      warn: options.warn ?? (() => {}),
      onHandlerError: options.onHandlerError,
      onValidationError: options.onValidationError,
    };
  }

  register<
    TChannel extends string,
    TInput extends z.ZodType,
    TOutput extends z.ZodType,
    TNativeContext = unknown,
  >(
    contract: IpcContract<TChannel, TInput, TOutput>,
    handler: TypedBackendHandler<
      z.infer<TInput>,
      z.infer<TOutput>,
      TNativeContext
    >,
  ): void {
    this.handlers.set(contract.channel, {
      channel: contract.channel,
      input: contract.input,
      output: contract.output,
      handle: handler as TypedBackendHandler<unknown, unknown>,
    });
  }

  has(channel: string): boolean {
    return this.handlers.has(channel);
  }

  listChannels(): string[] {
    return [...this.handlers.keys()].sort();
  }

  entries(): RegisteredTypedBackendContract[] {
    return this.listChannels().map((channel) => {
      const entry = this.handlers.get(channel);
      if (!entry) {
        throw new DyadError(
          `No typed backend handler registered for ${channel}`,
          DyadErrorKind.NotFound,
        );
      }
      return {
        channel: entry.channel,
        input: entry.input,
        output: entry.output,
      };
    });
  }

  async invoke<TNativeContext = unknown>(
    channel: string,
    rawInput: unknown,
    context: TypedBackendInvocationContext<TNativeContext>,
    options: TypedBackendRegistryOptions = {},
  ): Promise<unknown> {
    const registered = this.handlers.get(channel);
    if (!registered) {
      throw new DyadError(
        `No typed backend handler registered for ${channel}`,
        DyadErrorKind.NotFound,
      );
    }

    const parsedInput = registered.input.safeParse(rawInput);
    if (!parsedInput.success) {
      const error = new DyadError(
        `[${channel}] Invalid input: ${formatZodError(parsedInput.error)}`,
        DyadErrorKind.Validation,
      );
      const onValidationError =
        options.onValidationError ?? this.options.onValidationError;
      onValidationError?.(error, {
        channel,
        transport: context.transport,
      });
      throw error;
    }

    let result: unknown;
    try {
      result = await registered.handle(context, parsedInput.data);
    } catch (error) {
      const onHandlerError =
        options.onHandlerError ?? this.options.onHandlerError;
      onHandlerError?.(error, {
        channel,
        transport: context.transport,
      });
      throw error;
    }

    return this.validateOutput(channel, registered.output, result, options);
  }

  private validateOutput(
    channel: string,
    output: z.ZodType,
    result: unknown,
    options: TypedBackendRegistryOptions,
  ): unknown {
    const outputValidation =
      options.outputValidation ?? this.options.outputValidation;
    if (outputValidation === "none") {
      return result;
    }

    const shouldValidate =
      outputValidation === "throw" ||
      (outputValidation === "development-warn" &&
        process.env.NODE_ENV === "development");
    if (!shouldValidate) {
      return result;
    }

    const parsedOutput = output.safeParse(result);
    if (parsedOutput.success) {
      return outputValidation === "throw" ? parsedOutput.data : result;
    }

    const errorMessage = `[${channel}] Invalid output: ${formatZodError(
      parsedOutput.error,
    )}`;
    if (outputValidation === "throw") {
      throw new DyadError(errorMessage, DyadErrorKind.Internal);
    }

    const warn = options.warn ?? this.options.warn;
    warn(errorMessage.replace("Invalid output", "Output validation warning"));
    return result;
  }
}

export function createTypedBackendRegistry(
  options?: TypedBackendRegistryOptions,
): TypedBackendRegistry {
  return new TypedBackendRegistry(options);
}

export function registerTypedBackendHandler<
  TChannel extends string,
  TInput extends z.ZodType,
  TOutput extends z.ZodType,
  TNativeContext = unknown,
>(
  registry: TypedBackendRegistry,
  contract: IpcContract<TChannel, TInput, TOutput>,
  handler: TypedBackendHandler<
    z.infer<TInput>,
    z.infer<TOutput>,
    TNativeContext
  >,
): void {
  registry.register(contract, handler);
}

export function invokeTypedBackendHandler<TNativeContext = unknown>(
  registry: TypedBackendRegistry,
  channel: string,
  rawInput: unknown,
  context: TypedBackendInvocationContext<TNativeContext>,
  options?: TypedBackendRegistryOptions,
): Promise<unknown> {
  return registry.invoke(channel, rawInput, context, options);
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}
