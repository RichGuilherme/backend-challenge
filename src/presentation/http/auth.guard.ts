import {
  Inject,
  Injectable,
  SetMetadata,
  createParamDecorator,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { InvalidTokenError } from "../../application/auth/auth.errors";
import { TOKEN_VERIFIER, type ProviderIdentity, type TokenVerifier } from "../../application/ports/token-verifier";

export const IS_PUBLIC = "isPublic";

export const Public = (): ClassDecorator & MethodDecorator => SetMetadata(IS_PUBLIC, true);

export interface AuthenticatedRequest {
  headers: Record<string, string | string[] | undefined>;
  caller?: ProviderIdentity;
}

export const Caller = createParamDecorator(
  (_data: unknown, context: ExecutionContext): ProviderIdentity | undefined =>
    context.switchToHttp().getRequest<AuthenticatedRequest>().caller,
);

const BEARER_TOKEN = /^Bearer\s+(\S+)$/i;

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier | null,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.verifier === null || this.isPublic(context)) return true;
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    request.caller = await this.verifier.verify(bearerTokenOf(request));
    return true;
  }

  private isPublic(context: ExecutionContext): boolean {
    return (
      this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [context.getHandler(), context.getClass()]) ===
      true
    );
  }
}

function bearerTokenOf(request: AuthenticatedRequest): string {
  const header = request.headers.authorization;
  const token = typeof header === "string" ? BEARER_TOKEN.exec(header)?.[1] : undefined;
  if (!token) throw new InvalidTokenError("Token ausente ou malformado");
  return token;
}
