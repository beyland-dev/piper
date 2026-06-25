export interface ConstraintScope {
  constraints: string[];
  protectedFiles: string[];
}

export const ROOT_CONSTRAINT_SCOPE: ConstraintScope = {
  constraints: [],
  protectedFiles: []
};

const PROTECTED_FILE_PATTERN = /^do not modify\s+(.+)$/i;

export function protectedFileConstraint(filePath: string): string {
  return `do not modify ${filePath}`;
}

export function collectProtectedFiles(constraints: string[]): string[] {
  const protectedFiles = constraints
    .map((constraint) => constraint.match(PROTECTED_FILE_PATTERN)?.[1]?.trim())
    .filter((value): value is string => Boolean(value));

  return [...new Set(protectedFiles)];
}

export function extendConstraintScope(scope: ConstraintScope, additions: string[] = []): ConstraintScope {
  const constraints = [...new Set([...scope.constraints, ...additions])];

  return {
    constraints,
    protectedFiles: [...new Set([...scope.protectedFiles, ...collectProtectedFiles(additions)])]
  };
}
