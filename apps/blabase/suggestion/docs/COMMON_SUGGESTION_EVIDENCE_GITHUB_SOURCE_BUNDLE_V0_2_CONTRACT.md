# Common Suggestion Evidence GitHub Source Bundle V0.2 Contract

## 0. 문서 상태

| 항목 | 값 |
|---|---|
| 문서 ID | `COMMON-SUGGESTION-EVIDENCE-GITHUB-SOURCE-BUNDLE-V0.2` |
| 단계 | `Stage10-2B.2b` |
| 상태 | `FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW` |
| 문서 성격 | GitHub offline source-bundle 하위 계약 동결 제안 |
| 사람 결정권자 | `Colin` |
| 상위 계약 | `COMMON_SUGGESTION_EVIDENCE_SOURCE_VERIFICATION_V0_2_CONTRACT` |
| 상위 계약 제안 Git blob object ID | `0bdb0bc5d57d207ff1ff8b393d83a1d750eb7715` |
| 상위 계약 동결 receipt ID | `ECR-STAGE10-2B1-COLIN-COMMON-CONTRACT-FREEZE-2026-08-22` |
| 상위 계약 동결 Git commit object ID | `73e458174ac8d0cd1fef9a5bbf89c2a7e58be81b` |

위 두 40자리 값은 Git object ID다. 어느 값도 SHA-256 필드나
`Sha256LowerHex`로 취급하지 않는다.

이 문서는 **수정된 제안서일 뿐**이다. 문서의 존재나 QA 교정은 다음을 뜻하지
않는다.

- 계약 동결 또는 구현 승인
- offline fixture 또는 slice 수용
- verifier/adapter/collector 구현 또는 registry 등록
- GitHub provider capability 활성화
- live GitHub API, credential 또는 operational key 준비
- 테스트, 재검증, baseline, 통합 검증 또는 독립 QA 통과
- `verified:true`, public 또는 `authoritative:true` 권한

Colin이 Gate 1에서 exact bytes, 아래 `contractSha256`과 Git blob object ID를
승인하기 전까지 모든 선택은 `PROPOSED`다.

```text
contractSha256 = lowercase_hex(SHA-256(exact UTF-8 bytes of this contract document))
```

`contractSha256` 계산에는 newline 변환, Unicode normalization, BOM 추가·제거 또는
다른 byte rewriting을 적용하지 않는다. self-reference를 피하기 위해 실제 digest
값은 이 문서 안에 넣지 않는다. Gate 1에서 exact proposal bytes를 선택한 뒤 계산해
외부 freeze receipt와
`FrozenSourceVerifierContractAndCapsV0_2.contractSha256`에 동일한 값으로 저장한다.
Git blob/commit object ID는 이 SHA-256 identity와 계속 별개다.

## 1. 상위 권위와 불변식

1. 동결된 Common V0.2와 Lineage V0.1이 항상 이 문서보다 우선한다.
2. Common envelope, collector seal, callback result, diagnostic 또는 serialized
   failure-code union을 확장하거나 재정의하지 않는다.
3. `frozenSourceBundle`만 이 문서가 소유하는 별도 exact-key 값이다.
4. callback은 Stage2 expected output, A/B/C arm identity, suggestion text, model
   output 또는 다른 source evidence를 볼 수 없다.
5. 모든 성공 결과도 private이며 `authoritative:false`다.
6. comment/review body와 excerpt, suggestion title/summary/rank/caveat/intent/
   `semanticOutput`은 중첩, alias, hash, preview, embedding으로도 금지한다.
7. unknown field, version mismatch, ambiguity 또는 상위 계약 충돌은 fail closed다.
8. automated QA, Colin 계약 동결, 구현 승인, offline 결과 수용, operational
   activation은 서로 다른 gate다.

## 2. 목적과 범위

단일 목적은 GitHub task/activity 관찰을 privacy-minimized sealed offline bundle로
고정하고 동일한 Blabase Common Evidence builder와 Common V0.2 kernel이
결정론적으로 재생·비교하도록 만드는 것이다.

포함 범위:

- 단일 closed wire schema와 exact logical identity
- `repository_scope`와 `repository_activity`의 닫힌 mode union
- repository/activity scope, interval, pagination, record bijection
- runtime-owned HMAC identity와 collector seal
- Common Evidence V0.1 field-by-field projection
- canonicalization, hashing, sorting, normalization과 sealed truncation assertion
- Common 이하의 provider-specific caps
- 기존 Common failure/diagnostic/neutral issue-code alias
- fictional fixture, privacy, compatibility와 네 Colin gate

제외 범위:

- live REST/GraphQL, webhook, OAuth, GitHub App, PAT 또는 secret
- source verifier, adapter, collector, parser 또는 runtime 구현
- persistence, migration, dependency 또는 suggestion engine 변경
- A/B/C 조건 전달, 별도 renderer/generator 또는 authority 승격
- 실제 사용자/조직/repository fixture, 배포 또는 rollout
- live snapshot 계약 재사용 또는 compatibility union

## 3. exact logical identity

아래 literal은 Gate 1에서 함께 동결할 **제안 계약 identity**다. 현재 구현,
registry 등록, executable 존재 또는 capability availability를 주장하지 않는다.

```ts
const GITHUB_SOURCE_BUNDLE_V0_2_IDENTITIES = {
  source: "github",
  collectorId: "blabase.github.offline-collector",
  collectorVersion: "github-offline-collector-v0.2.0",
  adapterId: "blabase.github.offline-adapter",
  adapterVersion: "github-offline-adapter-v0.2.0",
  inputContractVersion: "github-offline-input-v0.2.0",
  sourceBundleContractVersion: "github.source-bundle.v0.2",
  verifierId: "blabase.github.source-verifier",
  verifierVersion: "github-source-verifier-v0.2.0",
  projectionVersion: "github-common-evidence-projection-v0.2.0",
  normalizationVersion: "github-neutral-text-normalization-v0.2.0",
  canonicalizationVersion: "rfc8785-jcs-v1",
  privacyPolicyVersion: "github-neutral-evidence-privacy-v0.2.0",
} as const;
```

Common envelope의 `preprocessingVersion`에는 위 `normalizationVersion`을
넣는다. Common frozen contract/caps의 source/verifier/bundle/projection 필드는
위 literal과 exact match해야 한다. alias, range, `latest`, fallback 또는
runtime-selected version은 금지한다.

### 3.1 exact cross-object equality

sealed envelope의 다음 필드는 manifest 및 Section 3 literal과 exact equal해야 한다.

| sealed envelope field | 반드시 같은 값 |
|---|---|
| `source` | `frozenSourceBundle.provider` = `GITHUB_SOURCE_BUNDLE_V0_2_IDENTITIES.source` |
| `collectorId` | `manifest.collectorId` = Section 3 `collectorId` |
| `collectorVersion` | `manifest.collectorVersion` = Section 3 `collectorVersion` |
| `adapterId` | `manifest.adapterId` = Section 3 `adapterId` |
| `adapterVersion` | `manifest.adapterVersion` = Section 3 `adapterVersion` |
| `inputContractVersion` | `manifest.inputContractVersion` = Section 3 `inputContractVersion` |
| `sourceBundleContractVersion` | `manifest.sourceBundleContractVersion` = `frozenSourceBundle.schemaVersion` = Section 3 `sourceBundleContractVersion` |
| `preprocessingVersion` | `manifest.normalizationVersion` = Section 3 `normalizationVersion` |
| `projectionVersion` | `manifest.projectionVersion` = Section 3 `projectionVersion` |

`FrozenSourceVerifierContractAndCapsV0_2`도 다음 equality를 만족해야 한다.

| frozen contract/caps field | 반드시 같은 값 |
|---|---|
| `source` | Section 3 `source` |
| `verifierId` | `manifest.verifierId` = Section 3 `verifierId` |
| `verifierVersion` | `manifest.verifierVersion` = Section 3 `verifierVersion` |
| `sourceBundleContractVersion` | `manifest.sourceBundleContractVersion` = Section 3 `sourceBundleContractVersion` |
| `preprocessingVersion` | `manifest.normalizationVersion` = Section 3 `normalizationVersion` |
| `projectionVersion` | `manifest.projectionVersion` = Section 3 `projectionVersion` |
| `contractSha256` | Gate 1 외부 freeze receipt의 `contractSha256` |

어느 equality라도 다르면 기존 Common mapping인
`SOURCE_BINDING_INVALID/source_bundle_invalid`로 거절한다. 이 하위 계약은 새 field,
failure code 또는 compatibility alias를 추가하지 않는다.

## 4. Common envelope와 별도 bundle

### 4.1 exact-key 경계

Common V0.2의 `SealedCollectionEnvelopeMetadataV0_2`는 동결된 exact-key
object 그대로 사용한다. `providerBody`, GitHub wrapper 또는 다른 key를 envelope에
추가하지 않는다.

```ts
type SourceVerifierInvocationV0_2 = Readonly<{
  trustedRuntimeContext: CommonV02.RestrictedSourceVerifierRuntimeContextV0_2;
  sealedEnvelope: CommonV02.SealedCollectionEnvelopeMetadataV0_2;
  frozenSourceBundle: unknown;
  frozenSourceContractAndCaps:
    CommonV02.FrozenSourceVerifierContractAndCapsV0_2;
}>;
```

GitHub callback은 별도 `frozenSourceBundle`만 Section 6 schema로 strict-parse한다.
위 표기는 parent alias이며 새 wire type이 아니다.

### 4.2 parent hash binding

`H(value) = lowercase_hex(SHA-256(RFC8785_JCS_UTF8(value)))`다.

```text
sealedEnvelope.artifactManifestSha256
  = H(frozenSourceBundle.manifest)

sealedEnvelope.sourceArtifactSetSha256
  = frozenSourceBundle.manifest.sourceArtifactSetSha256
  = H({
      activitiesSha256,
      domain: "blabase.github.source-bundle.v0.2.artifact-set",
      observedScopeSha256,
      pagesSha256,
      requestedScopeSha256,
      tasksSha256
    })
```

위 object의 값은 manifest component hash다. `artifactManifestSha256`는 manifest
자체 hash이므로 manifest에 복제하지 않는다. `commonBindingSha256` 또는 alias는
없다. Common envelope의 context/request/attempt/version fields와 collector seal이
parent binding을 소유한다.

### 4.3 seal과 authenticity

- Common runtime-owned `HMAC-SHA-256`, domain, purpose, preimage, key lifecycle과
  restricted handle을 그대로 상속한다.
- adapter/bundle/fixture는 key나 seal authority를 소유·전달하지 않는다.
- component hash와 Git object ID는 integrity/provenance일 뿐 authenticity가 아니다.
- Common HMAC preimage cap `1,048,576` bytes를 늘리거나 body를 조용히 절단하지
  않는다.
- GitHub가 offline artifact를 서명·보증한다고 주장하지 않는다.

## 5. identity와 privacy HMAC

### 5.1 repository identity와 cardinality

```ts
type TransientGitHubRepositoryIdentifierV0_2 = Readonly<{
  host: "github.com";
  repositoryDatabaseId: string; // exactly /^[1-9][0-9]{0,19}$/
}>;

type GitHubRepositoryRefV0_2 = Readonly<{
  repositoryIdentityHmacSha256: Sha256LowerHex;
}>;
```

- `TransientGitHubRepositoryIdentifierV0_2`는 wire type이 아니다. trusted collector/runtime
  내부의 canonicalization 및 HMAC 입력으로만 존재하고 직렬화 전에 release한다.
- requested transient identifiers는 canonicalization 뒤 unique `1..8`개다.
- observed transient identifiers는 `null` 또는 unique `0..8`개이며 non-null이면
  requested set의 부분집합이다.
- 각 transient identifier는 `GitHubRepositoryRefV0_2` 하나로 전사된다. requested wire
  refs는 unique `1..8`, observed wire refs는 `null` 또는 unique `0..8`이며 raw set과
  one-to-one image여야 한다.
- 빈 requested set은 `SCOPE_TOKEN_CANONICALIZATION_INVALID`이고 all/default
  scope를 뜻하지 않는다.
- owner/name/URL/login/node ID는 identity fallback이 아니다.
- raw database-ID numeric order는 transient token derivation에만 사용한다. wire의 scope,
  coverage, page 및 record 관계는 `repositoryIdentityHmacSha256` runtime ASCII order다.

### 5.2 frozen V0.1 token/HMAC canonicalization

1. identifier object는 정확히
   `{"host":"github.com","repositoryDatabaseId":"<canonical decimal>"}`다.
2. canonical token은 RFC 8785 JCS UTF-8 bytes의 unpadded RFC 4648 base64url이다.
3. token은 `^[A-Za-z0-9_-]+$`, runtime ASCII order, unique여야 한다.
4. requested/observed set은 frozen Lineage V0.1의 동일 canonicalization, sorting,
   HMAC domain, preimage, key/version을 사용하되 서로 독립적으로 bind한다.
5. caller token, display name, URL, standard base64, padding 또는 fallback
   normalization은 거절한다.
6. identifier objects, tokens, HMAC preimages와 key bytes는 transient private이며
   직렬화·로그·commit·engine/model 전달을 금지한다.

`requestedRepositoryScopeHmacSha256`와
`observedRepositoryScopeHmacSha256|null`은 parent binding이 소유하며 bundle에
복제하지 않는다.

trusted collector/runtime은 동일한 transient raw set에서 먼저 frozen V0.1 set HMAC과
각 repository identity HMAC을 모두 계산한다. 그 다음 raw identifier objects, canonical
tokens, HMAC preimages를 release하고 opaque refs만 bundle에 쓴다. requested/observed ref
arrays는 해당 raw sets의 one-to-one image여야 하며, observed raw set이 null일 때만
observed refs도 null이다. duplicate raw identifier, duplicate ref 또는 HMAC collision은
전체 bundle을 거절한다. Common parent binding은 set HMAC을 소유하고, manifest component
hash와 collector seal은 opaque ref arrays를 bind한다. verifier는 sealed opaque 관계를
검증하며 ref에서 raw identifier를 복원한다고 주장하지 않는다.

### 5.3 privacy-safe derived identities

아래 HMAC은 runtime-owned privacy-scope key와 RFC 8785 JCS UTF-8 preimage를
사용한다. raw provider ID와 raw Git object ID는 collector 내부에서만 transient하다.

HMAC preimage input 문법은 다음과 같이 닫혀 있다.

```text
objectDatabaseId   = canonical positive decimal string matching /^[1-9][0-9]{0,19}$/
providerEventIdKind = exact literal "github_event_database_id"
providerEventId    = canonical positive decimal string matching /^[1-9][0-9]{0,19}$/
headGitObjectId    = lowercase string matching /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
```

decimal 값에는 sign, leading zero, whitespace, exponent, number coercion 또는 Unicode
digit normalization이 없다. 필요한 stable object/event/head ID가 없거나 문법이
잘못되면 fail closed다. URL, owner/name, login, node ID, head, timestamp 또는 다른
provider field를 identity fallback으로 사용하지 않는다.

```text
repositoryIdentityHmacSha256 = HMAC-SHA-256(Kprivacy, JCS({
  domain: "blabase.github.source-bundle.v0.2.repository-identity",
  repositoryIdentifier
}))

objectIdentityHmacSha256 = HMAC-SHA-256(Kprivacy, JCS({
  domain: "blabase.github.source-bundle.v0.2.object-identity",
  objectDatabaseId,
  repositoryIdentityHmacSha256
}))

providerEventIdentityHmacSha256 = HMAC-SHA-256(Kprivacy, JCS({
  domain: "blabase.github.source-bundle.v0.2.event-identity",
  providerEventId,
  providerEventIdKind: "github_event_database_id",
  repositoryIdentityHmacSha256
}))

headArtifactIdentityHmacSha256 = HMAC-SHA-256(Kprivacy, JCS({
  domain: "blabase.github.source-bundle.v0.2.head-artifact",
  headGitObjectId,
  repositoryIdentityHmacSha256
}))
```

HMAC 결과는 lowercase 64 hex다. `objectDatabaseId`, `providerEventIdKind`와
`providerEventId`, `headGitObjectId`는 preimage에만 있고 bundle에 직렬화하지
않는다. head artifact identity는 event identity와 별도이며 Common activity facts로
전달하지 않는다.

```text
privateRepositoryToken
  = "private/repo_" + first_32_hex(repositoryIdentityHmacSha256)
```

이 token만 Common의 `projectRef`와 `repositoryFullName`에 들어간다. 상속된
field 이름에도 raw repository full name은 들어가지 않는다.

## 6. exact closed wire schema

### 6.1 primitives와 top level

```ts
type Sha256LowerHex = string; // exactly /^[0-9a-f]{64}$/
type CanonicalUtcMillis = string; // exactly YYYY-MM-DDTHH:mm:ss.SSSZ
type NonNegativeDecimalString = string; // exactly /^(0|[1-9][0-9]*)$/

type FrozenGitHubSourceBundleV0_2 = Readonly<{
  schemaVersion: "github.source-bundle.v0.2";
  provider: "github";
  manifest: GitHubBundleManifestV0_2;
  requestedScope: GitHubRequestedScopeV0_2;
  observedScope: GitHubObservedScopeV0_2;
  pages: readonly GitHubPageManifestV0_2[];
  tasks: readonly GitHubTaskRecordV0_2[];
  activities: readonly GitHubActivityRecordV0_2[];
}>;
```

모든 object는 closed다. unknown/duplicate key, optional key, `undefined`,
non-finite number, trailing comma 또는 JSON extension은 거절한다. bundle에는
`issues`, diagnostics, envelope, seal 또는 final result field가 없다.

### 6.2 manifest

```ts
type GitHubBundleManifestV0_2 = Readonly<{
  sourceKind: "offline_export";
  collectorId: "blabase.github.offline-collector";
  collectorVersion: "github-offline-collector-v0.2.0";
  adapterId: "blabase.github.offline-adapter";
  adapterVersion: "github-offline-adapter-v0.2.0";
  inputContractVersion: "github-offline-input-v0.2.0";
  sourceBundleContractVersion: "github.source-bundle.v0.2";
  verifierId: "blabase.github.source-verifier";
  verifierVersion: "github-source-verifier-v0.2.0";
  projectionVersion: "github-common-evidence-projection-v0.2.0";
  normalizationVersion: "github-neutral-text-normalization-v0.2.0";
  canonicalizationVersion: "rfc8785-jcs-v1";
  privacyPolicyVersion: "github-neutral-evidence-privacy-v0.2.0";
  parentCommonContractGitBlobObjectId:
    "0bdb0bc5d57d207ff1ff8b393d83a1d750eb7715";
  parentCommonFreezeReceiptId:
    "ECR-STAGE10-2B1-COLIN-COMMON-CONTRACT-FREEZE-2026-08-22";
  parentCommonFreezeGitCommitObjectId:
    "73e458174ac8d0cd1fef9a5bbf89c2a7e58be81b";
  requestedScopeSha256: Sha256LowerHex;
  observedScopeSha256: Sha256LowerHex;
  pagesSha256: Sha256LowerHex;
  tasksSha256: Sha256LowerHex;
  activitiesSha256: Sha256LowerHex;
  sourceArtifactSetSha256: Sha256LowerHex;
  requestedRepositoryCount: NonNegativeDecimalString;
  observedRepositoryCount: NonNegativeDecimalString | null;
  pageCount: NonNegativeDecimalString;
  taskCount: NonNegativeDecimalString;
  activityCount: NonNegativeDecimalString;
  textSpanCount: NonNegativeDecimalString;
  aggregateVisibleTextUtf8Bytes: NonNegativeDecimalString;
}>;
```

각 component hash는 해당 top-level value의 `H(value)`이며 위 count fields를 포함한
manifest 전체는 Section 4.2의 `artifactManifestSha256`으로 bind된다.
`requestedRepositoryCount`는 `requestedScope.repositoryRefs.length`와 exact equal한
canonical decimal `1..8`이다. `observedRepositoryCount`는
`observedScope.repositoryRefs`가 null일 때만 null이며, non-null이면 그 array length와
exact equal한 canonical decimal `0..8`이다. 나머지 count도 실제 unique
array/count와 exact match한다. Git blob/commit object ID는 40자리 Git provenance
literal이고 component SHA-256과 교환할 수 없다.

## 7. requested mode와 coverage

### 7.1 closed discriminated union

```ts
type GitHubActivityKindV0_2 =
  | "issue_opened"
  | "issue_closed"
  | "issue_reopened"
  | "issue_commented"
  | "pull_request_opened"
  | "pull_request_closed"
  | "pull_request_reopened"
  | "pull_request_merged"
  | "pull_request_reviewed"
  | "pull_request_review_commented"
  | "push";

type ActivityWindowV0_2 = Readonly<{
  start: CanonicalUtcMillis;
  end: CanonicalUtcMillis;
}>;

type GitHubRequestedScopeV0_2 =
  | Readonly<{
      requestedCollectionMode: "repository_scope";
      requiredOperations: readonly ["repository_scope_collection"];
      repositoryRefs: readonly GitHubRepositoryRefV0_2[]; // 1..8
      requestedActivityWindow: null;
      activityKinds: readonly [];
      pageLimitPerRepositoryPerOperation: "3";
    }>
  | Readonly<{
      requestedCollectionMode: "repository_activity";
      requiredOperations: readonly [
        "repository_scope_collection",
        "activity_pagination"
      ];
      repositoryRefs: readonly GitHubRepositoryRefV0_2[]; // 1..8
      requestedActivityWindow: ActivityWindowV0_2;
      activityKinds: readonly [GitHubActivityKindV0_2, ...GitHubActivityKindV0_2[]];
      pageLimitPerRepositoryPerOperation: "3";
    }>;
```

activity 배열은 union 선언 순서이며 duplicate은 금지한다. interval은
`[start,end)`, `start < end`, 최대 30일이다. 다른 mode/operation/window/kinds
조합, alias, default 또는 caller extension은 거절한다. Common envelope의
`requestedCollectionMode`와 `requiredOperations`는 선택 branch와 exact
match해야 한다.

두 mode의 record 동작은 다음과 같이 고정한다.

- `repository_scope`: top-level `activities`는 exact `[]`다. activity page,
  `activity_pagination` coverage, activity coverage 또는 covered activity interval이
  없어야 한다. top-level `tasks`에는 각 requested repository의
  `repository_scope_collection`에서 관찰된 Section 9.1의 세 work-item role만 들어간다.
- `repository_activity`: 동일한 `repository_scope_collection` task 규칙을 사용하고,
  top-level `activities`에는 requested repository refs, requested kinds와 requested
  `[start,end)` 안에서 `activity_pagination`으로 관찰된 Section 9.2 records만 들어간다.
- 두 mode 모두 task는 activity page에서 추론하지 않고 activity는 repository-scope
  page에서 만들지 않는다. empty result는 허용하지만 record origin을 바꾸는 fallback은
  금지한다.

### 7.2 observed scope

```ts
type CoverageStatusV0_2 = "complete" | "partial" | "unknown";

type GitHubOperationCoverageV0_2 = Readonly<{
  repositoryRef: GitHubRepositoryRefV0_2;
  operation: "repository_scope_collection" | "activity_pagination";
  status: CoverageStatusV0_2;
  firstRequestCursorSha256: Sha256LowerHex | null;
  finalResponseCursorSha256: Sha256LowerHex | null;
  pageCount: NonNegativeDecimalString;
  recordCount: NonNegativeDecimalString;
  terminalHasNextPage: boolean | null;
  stopReason: "complete" | "page_cap" | "source_error" | "untrusted";
}>;

type GitHubObservedScopeV0_2 = Readonly<{
  repositoryRefs: readonly GitHubRepositoryRefV0_2[] | null;
  repositoryScopeStatus: CoverageStatusV0_2;
  paginationStatus: "not_applicable" | CoverageStatusV0_2;
  coveredActivityIntervals: readonly ActivityWindowV0_2[] | null;
  operationCoverage: readonly GitHubOperationCoverageV0_2[];
}>;
```

observed repository refs는 null 또는 0..8개다. non-null covered intervals는 최대
1,024개, requested window 내부, start/end 순서, no overlap/adjacency인 canonical
merge다. 빈 배열은 trustworthy zero coverage, null은 absent/untrustworthy다.

`T = {(repositoryRef, operation) | repositoryRef ∈ requestedScope.repositoryRefs,
operation ∈ requestedScope.requiredOperations}`라 한다. `operationCoverage`는
exact `|T|` entries이며 `T`의 각 tuple과 exact match하는 entry가 정확히 하나 있어야
한다. extra, missing 또는 duplicate tuple은 거절한다. 따라서
`repository_scope`에는 repository별 `repository_scope_collection` entry만 있고
`activity_pagination` entry는 없으며, `repository_activity`에는 repository별 두
operation entry가 각각 하나씩 있다.

### 7.3 exact coverage derivation

Repository scope:

1. observed set이 null/untrustworthy면 `unknown` + `COVERAGE_UNKNOWN`.
2. trustworthy observed set이 requested와 다르면 빈 set 포함 `partial` +
   `SCOPE_PARTIAL`.
3. trustworthy sets가 같고 모든 repository page equation이 성립할 때만
   `complete`.

Activity scope:

1. pagination evidence/interval이 absent/untrustworthy 또는 status가 `unknown`이면
   `unknown`.
2. status가 `partial`이거나 interval union이 requested window strict subset이면
   `partial`. 빈 union과 gap도 포함한다.
3. status가 `complete`이고 interval union이 requested window와 exact equal일
   때만 `complete`.

`repository_scope`는 `paginationStatus:"not_applicable"`,
`coveredActivityIntervals:null`, top-level `activities:[]`이고 activity page 및
activity operation coverage가 없다. Repository completeness는 activity completeness를,
event timestamps는 interval coverage를 증명하지 않는다.

## 8. page manifest와 bijection

```ts
type GitHubPageManifestV0_2 = Readonly<{
  repositoryRef: GitHubRepositoryRefV0_2;
  operation: "repository_scope_collection" | "activity_pagination";
  requestedCollectionMode: "repository_scope" | "repository_activity";
  collectionRequestSha256: Sha256LowerHex;
  pageOrdinal: NonNegativeDecimalString;
  requestCursorSha256: Sha256LowerHex | null;
  responseEndCursorSha256: Sha256LowerHex | null;
  hasNextPage: boolean;
  recordIds: readonly string[];
  previousPageSha256: Sha256LowerHex | null;
  pageContentSha256: Sha256LowerHex;
  pageSha256: Sha256LowerHex;
}>;
```

`collectionRequestSha256 = H({activityKinds,requestedActivityWindow,
requestedCollectionMode,requiredOperations,repositoryRef})`다. page mode/hash는
top-level request와 exact match한다. repository_scope에서 activity page는 금지한다.

Section 7.2의 각 required tuple `t=(repoRef,operation)`에 대해 해당 tuple의 page
sequence를 `P(t)`라 한다. 대응 record set은 전역 array가 아니라 다음 opaque-ref
subset으로 exact 정의한다.

```text
R(repoRef, repository_scope_collection)
  = { taskId | top-level task.repositoryRef = repoRef }

R(repoRef, activity_pagination)
  = { activityId | top-level activity.repositoryRef = repoRef
                   AND activityKind is requested
                   AND occurredAt is inside requested [start,end) }
```

`U(t)`는 `P(t)`의 모든 `recordIds`를 순서대로 합친 multiset이다. 각 tuple마다
`U(t) = R(t)`이고 모든 ID의 multiplicity는 정확히 1이어야 한다. 모든 top-level task
또는 activity record는 정확히 하나의 required tuple에 속해야 하며, per-repository
page union을 global task/activity array 전체와 비교하지 않는다.

1. coverage `pageCount = |P(t)|`.
2. ordinal은 decimal `0..|P(t)|-1`, gap/duplicate 없음.
3. 첫 request cursor가 coverage first cursor와 같고 첫 previous hash만 null.
4. 이후 previous hash는 직전 page hash, request cursor는 직전 response cursor.
5. final response cursor와 hasNextPage는 coverage final fields와 exact match.
6. `pageContentSha256 = H(recordIds)`; page hash는 자기 hash key를 제외한
   object의 `H`.
7. coverage `recordCount = |U(t)| = |R(t)|`이고 위 tuple-local bijection을 만족.
8. page의 repositoryRef/mode/operation은 tuple 및 top-level request와 exact match.
9. 다른 page/operation/repositoryRef/array 중복 ID 또는 required tuple 밖 page는 거절.

cap은 `(repository,operation)`마다 3 pages다. 세 번째 page(ordinal `"2"`)가
`hasNextPage:false`면 complete 가능하다. 세 번째 page가 `hasNextPage:true`
또는 강제 중단이면 `page_cap`, partial, `PAGINATION_INCOMPLETE`다. page 수
3만으로 partial을 만들지 않는다.

## 9. task, activity와 text

### 9.1 task

```ts
type GitHubTaskRecordV0_2 = Readonly<{
  recordType: "task";
  taskId: string;
  signalHash: Sha256LowerHex;
  repositoryRef: GitHubRepositoryRefV0_2;
  objectIdentityHmacSha256: Sha256LowerHex;
  workItemRole:
    | "assigned_issue"
    | "review_requested_pull_request"
    | "authored_pull_request";
  number: string; // positive decimal and <= Number.MAX_SAFE_INTEGER
  state: "open";
  observedAt: CanonicalUtcMillis;
  updatedAt: CanonicalUtcMillis | null;
  title: GitHubAllowedTextSpanV0_2;
}>;
```

`taskId = "ghtask_" + objectIdentityHmacSha256`.
`signalHash = H({domain:"blabase.github.source-bundle.v0.2.task-signal",
objectIdentityHmacSha256,
repositoryIdentityHmacSha256:repositoryRef.repositoryIdentityHmacSha256,
workItemRole})`.
Raw object database ID, owner/name, URL, assignee, author, labels, body, branch,
diff 또는 code는 wire에 없다.

### 9.2 activity

```ts
type GitHubActivityRecordV0_2 = Readonly<{
  recordType: "activity";
  activityId: string;
  signalHash: Sha256LowerHex;
  repositoryRef: GitHubRepositoryRefV0_2;
  providerEventIdentityHmacSha256: Sha256LowerHex;
  activityKind: GitHubActivityKindV0_2;
  occurredAt: CanonicalUtcMillis;
  subjectTaskId: string | null;
  headArtifactId: string | null; // null or exactly /^artifact_[a-f0-9]{32}$/
  reviewState: "approved" | "changes_requested" | "commented" | null;
  textSpans: readonly GitHubAllowedTextSpanV0_2[];
}>;
```

- `activityId = "ghactivity_" + providerEventIdentityHmacSha256`.
- `signalHash = H({activityKind,
  domain:"blabase.github.source-bundle.v0.2.activity-signal",
  providerEventIdentityHmacSha256,
  repositoryIdentityHmacSha256:repositoryRef.repositoryIdentityHmacSha256})`.
- push이면 `headArtifactId = "artifact_" +
  first_32_hex(headArtifactIdentityHmacSha256)`이고 그때만 non-null이다. push가 아니면
  exact null이다. raw `headGitObjectId`는 transient HMAC preimage일 뿐 wire field,
  event identity 또는 SHA-256 field가 아니다.
- 같은 head artifact의 서로 다른 provider event는 같은 `headArtifactId`일 수 있지만
  서로 다른 event HMAC/activityId를 가져야 한다.
- issue/PR activity는 same-bundle task를 참조하고 push는 task null이다.
- review activity만 reviewState를 가질 수 있다.
- actor field는 없다. `actorRef`, raw login/name/email/node ID를 거절한다.
- comment/review body/excerpt/hash/embedding은 금지한다.

### 9.3 sealed text assertion

```ts
type GitHubAllowedTextSpanV0_2 = Readonly<{
  kind: "task_object_title" | "push_commit_message_subject";
  text: string;
  sourceUnicodeScalarCount: NonNegativeDecimalString;
  sourceUtf8ByteCount: NonNegativeDecimalString;
  normalizedUnicodeScalarCountBeforeTruncation: NonNegativeDecimalString;
  normalizedUtf8ByteCountBeforeTruncation: NonNegativeDecimalString;
  wasTruncated: boolean;
}>;
```

collector는 field 추출 직후 source counts를 재고, CRLF/CR→LF, NFC, Unicode
White_Space collapse, trim 순으로 normalize한 전체 counts를 잰 후 scalar 240 및
UTF-8 2,048 bytes를 모두 만족하는 최장 scalar-prefix를 wire text로 만든다.

```text
wasTruncated =
  normalizedUnicodeScalarCountBeforeTruncation > 240
  OR normalizedUtf8ByteCountBeforeTruncation > 2048
```

- false이면 visible counts와 normalized pre-truncation counts가 exact equal.
- true이면 한 cap 이상 초과하고 visible text는 두 cap의 최장 scalar-prefix.
- source field는 측정 전 최대 65,536 scalars/262,144 bytes. 초과는 collector
  partial/error이지 parser truncation이 아니다.
- verifier는 visible text, count 범위, formula와 내부 일관성을 검증한다. raw
  measurement와 prefix 진실성은 collector seal이 증명하며 count만으로 과장하지
  않는다.
- task title만 task-title kind, push만 최대 4 push-subject spans. 나머지는 빈 array.

## 10. canonicalization, sorting과 time

- raw bytes는 RFC 8785 JCS UTF-8와 byte-for-byte 같아야 한다.
- SHA-256은 lowercase 64 hex이고 hash는 `H`만 사용한다.
- parser가 normalization, sorting, default, coercion 또는 truncation하지 않는다.
- arrays는 repositoryRef의 `repositoryIdentityHmacSha256` runtime ASCII order,
  operation, ordinal, task ID, activity `(occurredAt,repositoryRef HMAC,
  activityKind declaration order,activityId)` 순이다.
- 시간은 exact UTC milliseconds다. activity는 requested `[start,end)` 안이다.
- callback은 wall clock, network, cache, environment 또는 model을 읽지 않는다.
- ID/HMAC collision은 suffix 없이 전체 bundle 거절이다.

## 11. Common Evidence V0.1 exact projection

### 11.1 공통 fields와 provenance

callback은 frozen Common builder와 record/fact ID constants를 그대로 사용한다.
GitHub-local version/hash domain을 만들지 않는다.

| Common field | exact source/derivation |
|---|---|
| `recordId` | frozen `runtimeStableId("evidence_record", RECORD_ID_VERSION, {kind, identitySha256:domainSeparatedSha256(PRIVATE_RECORD_IDENTITY_HASH_DOMAIN,{signalHash})})` |
| `kind` | task `github_work_item`, activity `github_activity` |
| `source` | `github` |
| `authority` | 아래 role별 exact 값 |
| `projectRef` | private repository token; raw full name 금지 |
| `observedAt` | sealed collection observation time; task assertion과 exact match |
| `sourceUpdatedAt` | task `updatedAt`, activity `occurredAt`; 없으면 null |
| `validUntil` | null; frozen parent lifecycle이 exact 값을 공급할 때만 사용 |
| `completeness` | applicable coverage unknown -> `unknown`; partial 또는 span truncation -> `truncated`; 아니면 `complete` |
| `facts` | 아래 closed table |
| `factIds` | frozen Common builder가 각 non-null fact에 생성; null fact는 null |

flat fact ID는 frozen
`runtimeStableId("evidence_fact",FACT_ID_VERSION,{recordId,factKey,
valueSha256:domainSeparatedSha256(FACT_VALUE_HASH_DOMAIN,value)})`를 사용한다.
literal version/domain은 상위 constants를 alias한다. provenance는 Common
callback/envelope에 남고 closed record에 임의 field로 주입하지 않는다.

Repository-scope work item은 repository coverage를 사용한다.
`repository_activity`의 work item/activity는 repository와 activity interval 중
더 나쁜 coverage를 사용한다. 순서는 `unknown > partial > complete`다.

### 11.2 task -> github_work_item

모든 task는 record 하나를 만든다.

| Common field/fact | assigned issue | review-requested PR | authored PR |
|---|---|---|---|
| `authority` | `primary_task_fact` | `primary_task_fact` | `structured_supporting_context` |
| `attentionCapability` | `candidate_input` | `candidate_input` | `overview_only` |
| `nativeTitle` | title.text | title.text | title.text |
| `repositoryFullName` | private token | private token | private token |
| `number` | positive integer | positive integer | positive integer |
| `objectType` | `issue` | `pull_request` | `pull_request` |
| `taskKind` | `assigned_issue` | `review_requested_pull_request` | `authored_pull_request` |
| `state` | `open` | `open` | `open` |
| `relationship` | `assigned_to_user` | `review_requested_from_user` | `authored_by_user` |
| `semanticRole` | `direct_work_item` | `direct_work_item` | `context_only` |
| `eligibilityLimit` | `none` | `draft_state_unknown` | `not_actionable_by_source_kind` |
| `draftState` | `not_applicable` | `unknown` | `unknown` |

Build identity는 exact `{signalHash}`다. Common work-item `facts`에는 표의
`attentionCapability`, `nativeTitle`, `repositoryFullName`, `number`, `objectType`,
`taskKind`, `state`, `relationship`, `semanticRole`, `eligibilityLimit`, `draftState`
11개 key만 있고 extra key는 없다. `destinationUrl`과 `actionability`는 현재 live
connector 전용 field이며 frozen Common builder input에 존재하지 않으므로 null이나
optional 형태로도 전달해서는 안 된다. number가 safe positive integer로 exact
변환되지 않으면 거절한다.

### 11.3 activity -> github_activity

모든 activity는 record 하나를 만든다.

| Common field/fact | exact source/derivation |
|---|---|
| `authority` | `structured_supporting_context` |
| `activityKind` | wire `activityKind` |
| `repositoryFullName` | private repository token |
| `activityAt` | wire `occurredAt` |

Build identity는 exact `{signalHash}`다. subject/ref/review/head/actor/text field는
closed Common activity facts에 추가하지 않는다. privacy-derived `headArtifactId`는
bundle artifact binding에만 남고 raw head object ID는 wire에도 남지 않는다.

### 11.4 closed neutral issue derivation

callback `derivedIssueCodes`만 frozen Lineage union을 사용한다. bundle에는 issue
또는 diagnostic field가 없다.

```ts
type GitHubDerivedIssueCodeV0_2 =
  | "SOURCE_UNAVAILABLE"
  | "COVERAGE_UNKNOWN"
  | "SCOPE_PARTIAL"
  | "PAGINATION_INCOMPLETE"
  | "WINDOW_GAP"
  | "COLLECTION_PARTIAL"
  | "PREPROCESSING_PARTIAL"
  | "UPSTREAM_ERROR_REPORTED";
```

- missing/untrustworthy observed scope -> `COVERAGE_UNKNOWN`
- trustworthy unequal repository sets -> `SCOPE_PARTIAL`
- activity page cap/forced stop -> `PAGINATION_INCOMPLETE`
- trustworthy activity interval strict subset/gap -> `WINDOW_GAP`
- source-reported partial -> `COLLECTION_PARTIAL`
- trustworthy upstream error -> `UPSTREAM_ERROR_REPORTED`
- explicit unavailable capability branch만 `SOURCE_UNAVAILABLE`
- GitHub에는 별도 preprocessing operation이 없어 `PREPROCESSING_PARTIAL` 자체
  생성 금지

모든 조건을 set union하고 frozen Lineage order로 canonicalize한다. suggestion
caveat/rank/title로 변환하거나 engine/model에 전달하지 않는다.

## 12. provider-specific caps

유효 cap은 항상 `min(Common cap, GitHub cap)`이다.

| 자원 | GitHub 상한 |
|---|---:|
| callback invocation | 1 |
| canonical frozen bundle | 1,048,576 bytes |
| requested repositories | 8 |
| observed repositories | null 또는 8 |
| requested interval | 30 days |
| task/activity/total records | 128 / 128 / 256 |
| pages per repository/operation | 3 |
| spans per record / total | 4 / 256 |
| visible scalars / UTF-8 bytes per span | 240 / 2,048 |
| pre-normalization scalars / bytes per field | 65,536 / 262,144 |
| aggregate visible text bytes | 131,072 |
| graph depth / own properties | 12 / 4,096 |

Private diagnostic은 Common V0.2 exact closed internal type, declaration order와
cumulative cap만 alias한다. GitHub diagnostic wire shape/code/string/cap을 만들지
않는다. 초과 entry를 drop/truncate/sample/split한 뒤 성공 처리하지 않는다.

## 13. verification과 failure precedence

### 13.1 candidate collection

structural/intrinsic receipt -> record-set binding -> source attestation 순서를 지킨다.
seal/parent binding 전 provider 해석이나 callback을 실행하지 않는다. 안전하게
평가 가능한 source에서는 모든 failure candidate를 수집한 뒤 frozen selector가
primary code를 고른다. `첫 실패 즉시 반환` 규칙은 없다.

```text
RESOURCE_LIMIT_EXCEEDED
INPUT_INVALID
SOURCE_BINDING_INVALID
SOURCE_ATTESTATION_INVALID
HASH_MISMATCH
SOURCE_VERIFIER_UNAVAILABLE
PRIVACY_SCOPE_CONTEXT_INVALID
PRIVACY_SCOPE_KEY_UNAVAILABLE
SCOPE_TOKEN_CANONICALIZATION_INVALID
PRIVACY_SCOPE_DIGEST_INVALID
TIMEZONE_PROFILE_INVALID
SOURCE_ATTESTATION_BINDING_MISMATCH
RECORD_ID_SET_MISMATCH
COVERAGE_INVALID
```

`TIMEZONE_PROFILE_INVALID`는 GitHub에 구조적으로 금지된다.

### 13.2 actual Common mapping

| mechanically observed condition | existing Common code/detail |
|---|---|
| callback/count/byte/work/diagnostic cap 초과 | `RESOURCE_LIMIT_EXCEEDED` / `invocation_resource_limit_exceeded` |
| malformed/extra/wrong-mode bundle 또는 parent exact-key 불일치 | `SOURCE_BINDING_INVALID` / `source_bundle_invalid` |
| collector seal/envelope/attestation invalid | `SOURCE_ATTESTATION_INVALID` / `collector_seal_invalid` |
| manifest/artifact-set hash mismatch | `HASH_MISMATCH` / `artifact_hash_mismatch` |
| context/request/attempt/lifecycle invalid | `PRIVACY_SCOPE_CONTEXT_INVALID` / `context_binding_invalid` |
| privacy key/handle unavailable | `PRIVACY_SCOPE_KEY_UNAVAILABLE` / `privacy_scope_key_unavailable` |
| token invalid, empty requested, 21-digit ID | `SCOPE_TOKEN_CANONICALIZATION_INVALID` / `scope_token_canonicalization_invalid` |
| requested/observed privacy digest mismatch | `PRIVACY_SCOPE_DIGEST_INVALID` / `privacy_scope_digest_invalid` |
| replayed count/ID-set 또는 page bijection mismatch | `RECORD_ID_SET_MISMATCH` / `record_id_set_mismatch` |
| same-ID content/provenance/envelope mismatch | `SOURCE_ATTESTATION_BINDING_MISMATCH` / `source_attestation_binding_mismatch` |
| operation/coverage/issue set mismatch | `COVERAGE_INVALID` / `coverage_invalid` |
| contained synchronous exception/sandbox rejection | `INPUT_INVALID` / `source_verifier_trapped` |

Declared callback rejection은 상위 closed mapping만 사용하며 unknown code나 raw error
message를 만들지 않는다.

### 13.3 callback vs watchdog

- callback frame 정상 복귀, live process/worker, unchanged snapshot/counters/registry,
  exact no-I/O completion record가 모두 있을 때만 synchronous exception을
  `INPUT_INVALID/source_verifier_trapped` source-local 결과로 본다.
- timeout/watchdog kill, process/worker loss, host termination, return-boundary loss 또는
  containment 불증명은 **operationally incomplete/unsealed**다. lineage result나
  competing failure를 반환하지 않는다.
- callback은 serial 1회이며 retry/fallback/version probing이 없다.

## 14. fictional fixture와 test plan

모든 fixture는 명백히 허구이며 실제 GitHub/user/repository/credential을 쓰지 않는다.

Positive/partial:

- `gh-v02-contract-sha-external-binding`: exact bytes의 external SHA-256 receipt/caps equality
- `gh-v02-cross-object-identity-equality`: envelope/manifest/frozen caps exact literals
- `gh-v02-parent-envelope-separate-bundle`: exact envelope와 separate bundle
- `gh-v02-repository-scope`, `gh-v02-repository-activity`: 두 mode
- `gh-v02-mode-record-invariants`: scope activity empty와 activity-mode record origin
- `gh-v02-operation-coverage-bijection`: requested tuple별 exact one coverage entry
- `gh-v02-opaque-repository-refs`: raw requested/observed sets와 opaque refs의 one-to-one
  image, sealed mapping, bundle 전체에 raw identifier key 없음
- `gh-v02-interval-boundaries`: `[start,end)`와 covered union
- `gh-v02-page-three-terminal`: page 3 false -> complete 가능
- `gh-v02-page-three-nonterminal`: page 3 true -> partial
- `gh-v02-page-bijection`: tuple-local cursor/count/union/repository-subset bijection
- `gh-v02-stable-id-preimage-grammar`: exact decimal/event-kind/head grammar
- `gh-v02-same-head-distinct-events`: same head artifact, distinct event HMAC/ID
- `gh-v02-manifest-repository-counts`: requested/observed null-or-length semantics
- `gh-v02-no-actor`: actor key 없는 closed record
- `gh-v02-truncation-sealed-true/false`: counts와 formula
- `gh-v02-common-projection`: exact 11 task facts와 activity field-by-field replay
- `gh-v02-derived-issues`: closed neutral union

Negative:

- envelope extra `providerBody`; nonexistent `commonBindingSha256`
- self-embedded/normalized-byte contract digest 또는 receipt/caps digest mismatch
- envelope/manifest/frozen caps identity/version equality mismatch
- 40-digit Git object ID를 SHA-256 field로 사용
- missing/zero/leading-zero/21-digit object 또는 event ID; wrong event-ID kind; fallback ID
- transient repository ID 21자리, empty requested, observed 9개
- frozen bundle의 `host`, `repositoryDatabaseId`, canonical token 또는 raw identifier object
- requested/observed raw-set image와 opaque ref array가 불일치
- requested/observed repository count null/length mismatch
- mode/operation/window/kinds mismatch; scope mode의 activity/page/coverage/interval
- operationCoverage tuple extra/missing/duplicate
- first/final cursor, page/record count 또는 bijection mismatch
- per-repository page union을 global array와 비교하거나 record가 두 tuple에 속함
- page 3 `hasNextPage:true`인데 complete 주장
- raw head object ID wire, malformed head preimage, non-push head artifact
- head object ID로 event identity 생성; raw provider event ID 직렬화
- raw login 또는 forbidden `actorRef`
- comment/review body/excerpt/hash/embedding
- truncation counts/formula/prefix inconsistency
- Common builder에 `destinationUrl`, `actionability` 또는 12번째 task fact 전달
- issue/diagnostic bundle field 또는 새 serialized code
- multiple failures에서 Common precedence와 다른 선택
- containment 없는 callback local rejection
- watchdog/process loss를 lineage failure로 반환
- expected output/arm/model 접근 또는 callback 두 번/retry

향후 구현 수용에는 deterministic replay, all negative fail-closed, exact
envelope/bundle/hash/seal, blind one-shot no-I/O harness, Common ID/projection replay,
privacy assertion, focused/full validation, ECR/identity/rollback, independent QA와 Colin
Gate 3가 모두 필요하다. 현재 존재하거나 통과했다는 주장이 아니다.

## 15. privacy, retention과 logging

허용 source text는 bounded task title과 push subject뿐이다. 금지 대상은
comment/review/issue/PR body, commit body, diff/patch/code, branch/tag,
repository owner/name/URL, actor/login/name/email, raw event/object ID, cursor,
credential, HMAC key/preimage, suggestion semantics와 expected output이다.

- 실제 bundle은 Git에 commit하지 않고 `.local/` 또는 승인 private store에 둔다.
- consent/lawful basis, retention, deletion과 derived invalidation은 Common을 상속한다.
- bundle 삭제 시 projection/cache/index/receipt reference도 삭제/무효화한다.
- log에는 contract/version, 승인 opaque run reference, hash/count/cap name과 Common
  bounded code/detail만 허용한다.
- title, push subject, raw bundle/API response, ID preimage, cursor, key 또는 exception
  text는 log하지 않는다.

## 16. compatibility와 change control

- parser는 `github.source-bundle.v0.2`만 허용한다.
- legacy/live/future union, alias, coercion, default, migration을 두지 않는다.
- schema/hash/HMAC/sort/text/cap/privacy/projection/callback 변경은 새 contract
  version, exact-byte `contractSha256`, Git blob object ID와 Colin freeze receipt가
  필요하다.
- 새 contract identity는 exact proposal bytes 선택 뒤 계산하고 외부 freeze receipt와
  frozen contract/caps에만 저장한다. self-hashed 문서 안에 digest 값을 넣거나 newline/
  Unicode normalization 뒤 계산하지 않는다.
- frozen artifact를 overwrite하지 않는다.
- 구현 시 narrowest version, ECR, fictional run identity와 rollback을 기록한다.
- Common drift가 발견되면 구현을 중단하고 Common이 이긴다.

## 17. 네 Colin gate

1. **Bundle contract freeze:** Colin이 exact document bytes, external
   `contractSha256`, Git blob object ID와 Section 3 equality를 승인한다. 코드,
   fixture, capability 또는 activation은 승인하지 않는다.
2. **Offline implementation approval:** parser/adapter/blind callback/fictional test
   작성을 별도 승인한다. 구현 결과나 operational provider는 승인하지 않는다.
3. **Offline slice acceptance:** 구현, validation, 독립 QA, privacy와 receipt를
   Colin이 검토한다. 수용 뒤에도 private, `authoritative:false`,
   operationally unavailable이다.
4. **Operational activation:** auth, secret lifecycle, origin, permissions, API/rate
   limit, deletion, observability, incident/rollback과 live sandbox 뒤 별도 승인한다.
   Stage10-2C 전 authority 승격은 금지한다.

## 18. Colin 제안 결정표

| 결정 | 권장안 | 상태 |
|---|---|---|
| parent boundary | exact Common envelope + separate bundle | `PROPOSED` |
| contract identity | exact UTF-8 bytes의 SHA-256을 external receipt/caps에 동일 저장 | `PROPOSED` |
| identities | Section 3 exact literals | `PROPOSED` |
| modes | closed two-branch union | `PROPOSED` |
| repository | raw 1..20 digits는 transient only; wire는 opaque HMAC refs 1..8, null/0..8 | `PROPOSED` |
| repository counts | requested exact length; observed null iff scope null, else exact length | `PROPOSED` |
| operation coverage | 모든 requested repository/operation tuple과 exact bijection | `PROPOSED` |
| activity identity | exact decimal event HMAC; raw head는 transient, wire는 별도 HMAC artifact | `PROPOSED` |
| actor | wire에서 제거 | `PROPOSED` |
| text | allowed span + sealed counts | `PROPOSED` |
| pagination | repository/operation당 3, terminal로 completeness | `PROPOSED` |
| projection | frozen Common builder 하나; work-item facts exact 11 keys | `PROPOSED` |
| failure | safe candidates + Common precedence | `PROPOSED` |
| authority | private, `authoritative:false` | `PROPOSED` |
| activation | 네 gate 분리 | `PROPOSED` |

## 19. Gate 1 체크리스트

- [ ] exact Git blob object ID를 freeze receipt에 기록한다.
- [ ] Git object ID를 SHA-256으로 부르지 않는다.
- [ ] exact document UTF-8 bytes의 `contractSha256`을 normalization 없이 계산해
      외부 freeze receipt와 frozen contract/caps에 동일하게 기록한다.
- [ ] exact Common envelope와 separate bundle에 동의한다.
- [ ] Section 3 identity literals와 envelope/manifest/frozen caps equality를 동결한다.
- [ ] two-mode union, exact operations/window/kinds와 mode별 record invariant를 동결한다.
- [ ] transient repository cardinality/20-digit/HMAC 규칙과 opaque-only wire refs를
      동결하고 `host`/`repositoryDatabaseId`/canonical token 직렬화를 금지한다.
- [ ] requested/observed repository count의 exact null/length 의미를 동결한다.
- [ ] operationCoverage tuple cardinality/bijection을 동결한다.
- [ ] tuple-local page/cursor/count/bijection과 page-3 terminal 규칙을 동결한다.
- [ ] object/event preimage 문법, event HMAC, privacy-derived head artifact와 no-actor에
      동의한다.
- [ ] sealed truncation assertion과 attestation 한계를 확인한다.
- [ ] exact 11-key work-item facts와 frozen Common projection/issue/failure/diagnostic만
      사용하고 live-only field를 전달하지 않는다.
- [ ] comment/review text와 suggestion semantics를 금지한다.
- [ ] private, `authoritative:false`와 fictional fixture를 확인한다.
- [ ] QA 교정이 re-QA 통과, freeze, 구현 승인 또는 activation이 아님을 확인한다.
- [ ] 네 gate를 각각 별도 승인한다.

## 20. 다음 상태 전이

```text
FREEZE_PROPOSAL_READY_FOR_COLIN_REVIEW
  -- independent re-QA and Colin approval of exact document identity -->
GITHUB_SOURCE_BUNDLE_CONTRACT_FROZEN_BY_COLIN
```

그 뒤에도 다음은 별도 Colin 결정이다.

```text
GITHUB_SOURCE_BUNDLE_CONTRACT_FROZEN_BY_COLIN
  -> OFFLINE_IMPLEMENTATION_APPROVED_BY_COLIN
  -> OFFLINE_SLICE_ACCEPTED_BY_COLIN
  -> OPERATIONAL_ACTIVATION_APPROVED_BY_COLIN
```

중간 상태를 건너뛰지 않는다. Stage10-2C의 별도 authority 결정 전에는 public 또는
`authoritative:true`가 허용되지 않는다.
