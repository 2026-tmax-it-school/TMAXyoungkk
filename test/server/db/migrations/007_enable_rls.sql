-- 행 수준 보안 켜기(WP2 소유, 2026-10-17). Supabase에 올릴 때를 위한 안전장치다.
-- Supabase는 public 스키마의 표를 Data API(PostgREST)로 내보내고, 공개 anon 키만 있으면 누구나 그 API를 부를 수 있다.
-- 정책 없이 RLS만 켜면 anon·authenticated 역할은 아무 행도 읽거나 쓰지 못한다.
-- 앱 서버는 표 주인(postgres)으로 붙으므로 RLS를 지나친다(FORCE를 쓰지 않는다). 로컬 PostgreSQL에서도 동작은 그대로다.

ALTER TABLE schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE trips ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_ops ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_days ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_legs ENABLE ROW LEVEL SECURITY;
ALTER TABLE trip_spots ENABLE ROW LEVEL SECURITY;
ALTER TABLE invite_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE route_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_identities ENABLE ROW LEVEL SECURITY;
ALTER TABLE auth_oauth_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE community_photos ENABLE ROW LEVEL SECURITY;

-- Supabase 역할이 있으면 표 권한도 거둔다(로컬 PostgreSQL에는 이 역할이 없어 건너뛴다).
DO $$
DECLARE r text;
BEGIN
  FOREACH r IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = r) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', r);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', r);
    END IF;
  END LOOP;
END $$;
