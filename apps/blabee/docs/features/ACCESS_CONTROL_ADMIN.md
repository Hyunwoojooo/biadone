# Blabee 계정·전체 사용 제어 운영

이 문서는 `202609270001_blabee_access_control.sql`의 적용·관리 절차다. 2026-09-27 운영 적용과 소유자 관리자 지정, 실제 Google OAuth 검사, r75 공개 배포를 완료했다. 설치 앱 교체는 별도다.

운영 적용은 기존 migration 이력 테이블과 접근 제어 스키마가 없는 것을 확인한 뒤 SQL Editor에서 이 새 migration만 한 번 실행했다. `supabase db push`로 과거 migration을 재실행하지 않았다. 적용 원본 SHA-256은 `aafd7dd7dd60c9c7d7b344263a04de2bbe6949aba25178e1110e05b9c82ed40c`이다.

실제 Google 로그인과 refresh 후 `active`, 관리자 자신의 계정 중지·복원, 전체 서비스 `false` 유지 호출, 해당 검사 세션만 logout 후 이전 JWT 두 개의 HTTP 403을 확인했다. 익명 public RPC는 HTTP 401/42501, 비공개 스키마 요청은 HTTP 406/PGRST106으로 거절됐다. Google/GitHub 제공자는 모두 활성화돼 있으며 이번 실제 로그인 검사는 Google만 수행했다. 전체 서비스의 실제 중지와 다른 사용자의 계정 변경은 수행하지 않았다. 새 운영 변경은 아래 절차와 별도 변경 기록을 따른다.

## 제품 정책과 권한 경계

- 실제 Google/GitHub identity를 보유하고 OAuth로 인증된 세션은 첫 권한 조회 때 자동으로 `active`가 된다. 기존 `suspended` 행은 자동 활성화하지 않는다.
- 계정별 `suspended`와 전체 `paused`를 별도로 보관한다. 전체 재개는 개별 정지를 해제하지 않는다.
- 제품 정지는 Supabase Auth ban이나 계정 삭제가 아니다. 정지된 사용자는 로그인과 상태 확인을 계속할 수 있다.
- 관리자 membership은 비공개 DB 테이블로 결정한다. `user_metadata`, `app_metadata`, 앱 UI의 상태, 분석·결제 테이블은 관리자 또는 사용 권한의 근거가 아니다.
- 관리자 API는 유효한 소셜 세션과 현재 membership을 검사한다. 관리자의 제품 계정이 정지됐거나 서비스 전체가 정지돼도 재개 API를 사용할 수 있다. Auth ban·로그아웃·삭제는 관리자에게도 적용된다.

`blabee_access`는 REST 노출 스키마에 추가하지 않는다. 네 테이블 모두 RLS를 켜고 클라이언트 정책과 직접 접근 권한을 제공하지 않는다. `anon`, `authenticated`, `service_role`은 테이블·시퀀스·private helper에 접근할 수 없다. 세 개의 public RPC만 `authenticated` 실행을 허용하며, 관리자 RPC는 함수 안에서 다시 membership을 확인한다.

## 앱 서비스 조회 계약

공통 서비스가 고정된 Supabase HTTPS 주소로 직접 요청한다. `POST /rest/v1/rpc/get_blabee_access`에는 publishable key와 현재 사용자의 Bearer access JWT, 아래 JSON을 보낸다. 입력에는 사용자 ID나 희망 상태를 받지 않는다.

```json
{"p_nonce":"요청마다 새로 만든 UUID"}
```

성공 응답은 배열이 아닌 하나의 JSON object다.

```json
{
  "schema_version": 1,
  "request_nonce": "요청 UUID",
  "user_id": "현재 인증된 사용자 UUID",
  "session_id": "현재 인증된 Supabase 세션 UUID",
  "status": "active",
  "server_now": "2026-09-27T00:00:00.123456+00:00",
  "access_expires_at": "2026-09-27T00:05:00.123456+00:00",
  "refresh_after_seconds": 60
}
```

`status`는 `active`, `suspended`, `service_paused`, `social_login_required` 중 하나다. 소셜 인증 부족, 계정 정지, 전체 정지 순서로 평가하며 `active`만 만료시각을 갖는다. 나머지는 `access_expires_at: null`이다. 관리자 사유나 다른 계정의 정보는 반환하지 않는다.

활성 허가 만료는 `server_now + 300초`, JWT `exp`, 세션 `not_after` 중 가장 이른 시각이다. `not_after`가 null이면 그 제한만 생략한다. 따라서 마지막 허용 응답 후 300초는 상한이며, JWT 또는 세션이 먼저 만료되면 오프라인 허용도 먼저 끝난다.

서비스는 응답의 schema version, nonce, 사용자 일치, 세션 UUID 형식, 상태와 시간 범위를 확인한 뒤 메모리에서만 허가를 보관한다. 세션 소유권은 RPC가 서명 검증된 JWT와 Auth 저장소를 대조한다. 재시작·계정 변경·로그아웃은 기존 허가를 제거한다. 정상 갱신 간격은 60초다. 네트워크/일시적 서버 장애가 나도 마지막 허가의 만료를 연장하지 않으며, 명시적인 정지·인증 거절은 즉시 허가를 제거한다. 이 SQL은 클라이언트의 타이머나 수신 검증을 대신하지 않는다. nonce는 해당 HTTPS 요청과 응답을 연결하며, DB에 저장하거나 장기 서명 토큰으로 사용하지 않는다.

| 결과 | SQLSTATE / HTTP | 서비스 처리 |
| --- | --- | --- |
| OAuth 조건 미충족 또는 제품 사용 정지 | 200, 거절 status | 허가 제거, 해당 상태 표시 |
| 세션 누락·로그아웃·사용자 삭제·ban·만료 | `28000` / 403 | 허가 제거, 다시 인증 필요 |
| 잘못된 JWT 자체 | PostgREST JWT 오류 / 401 | 허가 제거, 다시 인증 필요 |
| 일반 사용자 관리자 호출 | `42501` / 403 | 관리자 변경 거절 |
| null nonce·잘못된 관리자 입력 | `22023` / 400 | 요청 오류 수정 |
| 권한 기본 설정 행 누락 | `55000` / 500 | 운영 오류; 기존 허가도 원래 만료까지만 |

HTTP 매핑은 [PostgREST 공식 오류 문서](https://docs.postgrest.org/en/stable/references/errors.html)에 따른다. 배포된 PostgREST의 실제 HTTP 응답은 적용 후 별도 확인한다. Bearer JWT, refresh token, 인증 응답 전체를 로그나 감사 사유에 기록하지 않는다.

## 인증 스키마 의존성과 확인 범위

RPC는 서명 검증을 PostgREST에 맡기고 `auth.uid()`와 `auth.jwt()`의 subject 일치, role, anonymous flag, 만료를 검사한다. 이어 실제 `auth.users`와 해당 사용자의 `auth.sessions`를 조회해 `banned_until`, `deleted_at`, `is_anonymous`, `not_after`를 확인한다. 로그아웃된 세션의 행을 확인하는 방식은 [Supabase 세션 문서](https://supabase.com/docs/guides/auth/sessions)에 근거한다.

소셜 조건은 서명된 `amr` 배열의 `oauth`와 현재 `auth.identities`의 `google`/`github` membership을 모두 요구한다. 허용 identity가 연결돼 있더라도 password/OTP 세션만 있으면 거절한다. 관련 claim은 [JWT 필드 문서](https://supabase.com/docs/guides/auth/jwt-fields)에 정의되어 있다. OAuth AMR 자체는 보통 공급자를 구별하지 않으므로 이 검사가 입증하는 것은 **허용 identity 보유와 해당 세션의 OAuth 인증**이다. 다른 OAuth 공급자를 추가할 때는 공급자 제한 정책을 다시 검토한다.

2026-09-27 공식 Auth source의 [Session](https://github.com/supabase/auth/blob/master/internal/models/sessions.go), [User](https://github.com/supabase/auth/blob/master/internal/models/user.go), [Identity](https://github.com/supabase/auth/blob/master/internal/models/identity.go)에서 위 컬럼을 확인했다. 이는 운영 DB 스키마를 조회한 결과가 아니다. 적용 전 SQL Editor에서 읽기 전용으로 확인한다.

```sql
select table_name, column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'auth' and (
    (table_name = 'users' and column_name in ('id','banned_until','deleted_at','is_anonymous'))
    or (table_name = 'sessions' and column_name in ('id','user_id','not_after'))
    or (table_name = 'identities' and column_name in ('user_id','provider'))
)
order by table_name, ordinal_position;
```

이 검사는 Auth 프로젝트 설정 전체를 SQL로 재구현하지 않는다. inactivity·single-session·time-box 정책은 토큰 갱신과 Auth의 적용 시점에도 영향을 받는다. 실제 OAuth 로그인 후 갱신된 JWT에 OAuth AMR이 유지되는지, 해당 프로젝트의 세션 정책과 함께 동작하는지는 staging/승인된 테스트 계정으로 확인한다.

## 적용 순서

1. 기존 SQL Editor 적용 이력과 실제 스키마를 확인한다. 이미 적용된 migration을 `supabase db push`로 다시 실행하지 않는다.
2. 아래 격리 테스트를 실행한다. 새 외부 의존성은 없으며 기존 PGlite를 사용한다.

   ```sh
   node --test Tests/Cloud/access-control.test.mjs
   ```

3. 운영 변경 승인을 받은 뒤 새 migration만 trusted migration owner로 한 번 적용한다. 함수 owner는 생성한 테이블 소유권과 필요한 `auth` 테이블 읽기 권한을 가져야 한다.
4. private schema가 노출되지 않았고 public RPC가 새 schema cache에서 발견되는지 확인한다. 같은 SQL을 재실행하는 방식으로 cache 문제를 해결하지 않는다.
5. 승인된 관리자 계정을 지정하고 실제 HTTP/JWT 확인을 마친 뒤, 별도 승인된 앱 배포를 진행한다. 권한을 강제하지 않는 기존 앱은 이 migration만 적용해 원격 차단할 수 없다.

## SQL Editor: 관리자 지정과 조회

계정의 실제 UUID를 먼저 찾는다. 이메일은 trusted 관리자 조회에서만 사용한다.

```sql
select u.id, u.email, array_agg(i.provider order by i.provider) as providers
from auth.users u
left join auth.identities i on i.user_id = u.id
where u.email = '관리자 이메일로 교체'
group by u.id, u.email;
```

아래 UUID를 조회한 값으로 바꿔 실행한다. `false`는 관리자 권한 회수다. public 관리자 API에는 membership 변경 기능이 없다.

```sql
select blabee_access.set_admin_membership(
    '00000000-0000-0000-0000-000000000000'::uuid,
    true,
    '운영자 이름 / 관리자 지정 사유 또는 변경 기록 번호'
);
```

이 helper는 `SECURITY INVOKER`이고 API role의 실행 권한이 없다. 감사행은 실제 DB `session_user`를 저장하며, 사용자·세션 actor는 null이다. SQL Editor에서는 JWT claims를 인위적으로 설정해 다른 사용자인 것처럼 관리자 API를 호출하지 않는다. SQL 운영자 이름을 사유에 남겨도 이는 사람이 입력한 기록이며, 사용자 JWT로 인증된 관리자 actor와는 구별한다.

상태와 이력을 조회한다. 감사 이력은 사용자 삭제 후에도 UUID와 사유를 보관한다. 이번 migration은 감사기록 자동 삭제 정책을 추가하지 않는다.

```sql
select u.id, u.email, a.status, a.updated_at, a.updated_by, a.reason
from auth.users u
left join blabee_access.user_access a on a.user_id = u.id
order by a.updated_at desc nulls last;

select paused, updated_at, updated_by, reason
from blabee_access.service_control where singleton;

select user_id, enabled, updated_at, reason from blabee_access.admin_users;

select id, created_at, actor_user_id, actor_session_id, actor_database_role,
       target_user_id, action, before_state, after_state, reason
from blabee_access.audit_events order by created_at desc, id desc limit 100;
```

`user_access`가 없는 계정은 아직 권한 조회·관리 상태 지정이 없었다는 뜻이다. 이 조회만으로 그 계정이 소셜 인증 조건을 충족했다고 판단하지 않는다.

## 인증된 관리자 API

관리자 계정으로 소셜 로그인한 운영 클라이언트에서 실행한다. 헤더는 일반 조회와 동일하게 publishable key와 **관리자 본인의 access JWT**를 사용한다. service-role key나 새 signing secret은 사용하지 않는다.

```text
POST /rest/v1/rpc/admin_set_blabee_user_access
Content-Type: application/json
apikey: <publishable key>
Authorization: Bearer <administrator access JWT>
```

```json
{"p_user_id":"대상 사용자 UUID","p_status":"suspended","p_reason":"운영 중지 사유"}
```

재개는 `p_status: "active"`다. 응답에는 `user_id`, `status`, `changed`, `updated_at`, `audit_id`가 있다.

```text
POST /rest/v1/rpc/admin_set_blabee_service_access
```

```json
{"p_paused":true,"p_reason":"전체 점검 사유"}
```

전체 재개는 `p_paused: false`다. 응답에는 `paused`, `changed`, `updated_at`, `audit_id`가 있다. 관리자 변경에는 공백을 제외한 1~500자 사유가 필요하다. 상태가 이미 같으면 `changed: false`를 반환하지만 그 요청도 감사한다. 상태 변경과 감사 저장은 한 트랜잭션이며 감사 저장 실패 시 상태도 바뀌지 않는다. 응답을 잃었다면 먼저 현재 상태와 감사기록을 확인한다.

## SQL Editor: trusted owner의 제품 상태 변경

일상 변경은 위 관리자 API를 사용한다. SQL Editor로 직접 복구해야 할 때는 아래처럼 상태와 감사행을 같은 트랜잭션으로 변경한다. 이는 데이터베이스 소유자 권한을 사용하는 운영 절차이며, actor UUID를 임의로 채우지 않는다. 일반 API role에는 실행 권한이 없다.

계정별 정지·재개 예제다. 대상 UUID, 상태, 사유를 교체한다. 계정이 없거나 사유가 유효하지 않으면 제약조건으로 전체 변경이 실패한다.

```sql
begin;
do $operation$
declare
    v_user_id uuid := '00000000-0000-0000-0000-000000000000';
    v_status text := 'suspended'; -- 재개: active
    v_reason text := '운영자 이름 / 직접 복구 사유';
    v_before text;
    v_now timestamptz;
begin
    insert into blabee_access.user_access(user_id) values(v_user_id)
        on conflict(user_id) do nothing;
    select status into strict v_before from blabee_access.user_access
        where user_id = v_user_id for update;
    v_now := clock_timestamp();
    update blabee_access.user_access set status = v_status, updated_at = v_now,
        updated_by = null, reason = v_reason where user_id = v_user_id;
    insert into blabee_access.audit_events(actor_database_role, target_user_id,
        action, before_state, after_state, reason, created_at)
    values(session_user, v_user_id, 'set_user_access', v_before, v_status, v_reason, v_now);
end;
$operation$;
commit;
```

전체 정지·재개 예제다. 계정별 상태는 변경하지 않는다.

```sql
begin;
do $operation$
declare
    v_paused boolean := false; -- 정지: true, 재개: false
    v_reason text := '운영자 이름 / 전체 복구 사유';
    v_before boolean;
    v_now timestamptz;
begin
    select paused into strict v_before from blabee_access.service_control
        where singleton for update;
    v_now := clock_timestamp();
    update blabee_access.service_control set paused = v_paused, updated_at = v_now,
        updated_by = null, reason = v_reason where singleton;
    insert into blabee_access.audit_events(actor_database_role, action,
        before_state, after_state, reason, created_at)
    values(session_user, 'set_service_access',
        case when v_before then 'paused' else 'running' end,
        case when v_paused then 'paused' else 'running' end, v_reason, v_now);
end;
$operation$;
commit;
```

## 검증과 남은 배포 확인

PGlite 검사는 실제 SQL을 실행해 16개 그룹을 확인한다: private 권한/RLS, anonymous·일반 사용자 차단, nonce와 기본 활성화, 관리자 bootstrap 감사, 계정 정지·재개, 전체 정지와 관리자 복구, 최초 조회 전 정지 보존, OAuth·identity 조건, 잘못된 JWT claim, 로그아웃·세션 소유권, Auth ban·삭제, 300초/JWT/세션 만료 상한, 관리자 입력, 감사 실패 원자성, 관리자 권한 회수, 계정 삭제 후 감사 보존이다. 이 SQL fixture는 전부 rollback한다. 이어 이 문서의 SQL 예제 6개도 같은 일회성 메모리 DB에서 실행해 상태와 감사행을 확인한 후 DB를 폐기한다.

이 결과는 실제 Supabase JWT 서명 검증·HTTP status·프로젝트 권한 설정·동시 접속을 입증하지 않는다. 적용 후 승인된 테스트 계정에서 다음을 확인한다.

- Google/GitHub 로그인과 토큰 갱신 후 조회 성공. 공개키 단독·anonymous Auth 사용자·일반 사용자 관리자 호출 거절.
- 로그아웃 전 JWT를 보관한 시험 요청이 logout 후 403이 되는지, Auth ban과 삭제도 거절되는지 확인. 토큰은 테스트 종료 후 폐기하고 기록하지 않는다.
- 두 사용자의 상태가 분리되는지, 관리자 membership 회수가 기존 JWT에도 바로 적용되는지 확인.
- 여러 연결에서 최초 조회와 정지 요청을 경쟁시켜 최종 정지가 보존되는지 확인. 동시 관리자 변경은 실제 처리 순서대로 감사되는지 확인.
- 서비스에서 정상 갱신·offline 만료·명시적 deny·앱 재시작·계정 변경을 확인. 기존 허가가 있던 서비스의 원격 정지는 정상 갱신 때 관찰되며, 통신 불가 시 마지막 허가의 최대 300초 상한이 적용된다.
- 관리자 설정 변경 후 audit의 actor·시간·사유·전후 상태를 확인. 마지막 관리자 해제 또는 Auth ban을 실행하기 전 trusted DB owner 복구 경로를 확인한다.

오류가 나면 기본 allow로 우회하지 않는다. 변경이 필요한 SQL은 새 migration으로 추가한다. 운영 테이블을 삭제하거나 기존 감사기록을 지우는 방식으로 롤백하지 않는다.
