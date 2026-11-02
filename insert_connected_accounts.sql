-- ====================================================================
-- Restore Connected Social Accounts & Tokens for Palak Gemini Workspace
-- ====================================================================

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('f166c4df-4f10-498b-915a-d5aae6b6e880', '4386cbf8-47bf-41fe-a925-0549bced08f2', 'youtube', 'UCyA3wMqiw5Dp-pa8jPuGwfw', 'Hindustansocialnetwork', 'CONNECTED', '2026-10-15T19:02:54.012Z')
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('ba86baec-532a-416a-8266-8c4e201f30fc', '4386cbf8-47bf-41fe-a925-0549bced08f2', 'linkedin', 'urn:li:person:91BIqvndCz', 'palak kashyap', 'CONNECTED', '2026-10-17T13:02:22.881Z')
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('56bdf6fd-6944-4b58-8afd-6bd8f9f14765', '4386cbf8-47bf-41fe-a925-0549bced08f2', 'facebook', '1389305704261474', 'Hindustan social network', 'CONNECTED', '2026-10-21T08:03:48.720Z')
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('e343e8df-5168-4f40-879c-35dcbe2d186c', '4386cbf8-47bf-41fe-a925-0549bced08f2', 'instagram', '17841450582690207', '@hindustan_social_network', 'CONNECTED', '2026-10-21T08:03:48.720Z')
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

INSERT INTO social_accounts (id, workspace_id, platform, provider_id, name, state, last_sync)
VALUES ('54dba928-27a0-4753-88ee-8fe5fc3e6c3e', '4386cbf8-47bf-41fe-a925-0549bced08f2', 'telegram', '-1001512721655', 'Hindustan software Solution (@hssblockchaindeveloments)', 'CONNECTED', '2026-10-27T06:54:52.004Z')
ON CONFLICT (id) DO UPDATE SET state = EXCLUDED.state, name = EXCLUDED.name;

-- ====================================================================
-- Restore Encrypted Access Tokens
-- ====================================================================

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('ba86baec-532a-416a-8266-8c4e201f30fc', 'w5nnIoWHUjXdx9qT.SaG3gyfJ4uxCdKHSwylOLg==.01lmpDonJbU7BJX9lMSQR7TamI7j6/DYxdir+gS1uxAiD0jhqyXlFEHdI2/X0FxPVQigFG3nT+8J9aLjclOIulUd1y3rBTuwwL88GJLJRUoeeXpX6QA//dwwXAXzzHDZ5fC0DAjpfJtoKFczRzJpMEn19/lE0id/R2LOH8XFc75M8BC3I1EAhj5CKd/N6tvK5odCHjacoLJEhZJg07satSgFfOKbtLck25I39ppzr3z6Xp6MMghk3GQlEc/O+Jo2sfBJu1fP1wZC/jJFLb+M6JiOISVqd3o/3eKeh/P0rYsecKHi1mIaXSy7z60flHv2Xqu1164i2bNr0zspUdhSbfF0B/A1bl5MEKnelgGVpIZ/fqr6PSWiQwFUKkyvdxa6CRhaMzopZONtVuO5dSMg4VVc1Z1jD8jDj/AwdFfKHCEki4Cdu+jKr8pM6/cW35OPexI5wsWAu4Q6wgiC9sg=', NULL, NULL)
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, expires_at = EXCLUDED.expires_at;

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('f166c4df-4f10-498b-915a-d5aae6b6e880', 'G2DB63jV+8trJiT4.7ZoPLcnWMmT9SoIhXjYMuw==.iOh2xIdcgHNUpDD2oV0S18pyTkTx4qFGYmZcSTMX9pql3sjfbRlLL6W+B2xXUoIAClYcdaVKriky679sa4SViMj2MeFkaIE3sT9MFeXkEc05c7tpQ5PRK+9Eimc52Ly+WPeT6YWtIAiGbEoIXN6v+gIM1S9N50sTHXmsA71u5fq/SfzQGE8HDO8gfn9oUKB824y2Daf4ypN8GUOvw26ArlZJRSkJanpCgnxow/MQLIRT97/GH/6XzwQZJVj03qD7LBg9eKXCC3WfsvcVhvIq5TC/QtVeXTagoXlxhx6mubSMJa3Wp4D+evIKaI4NfqIzKzsuHbNsPPDM5ajdRVk=', '2026-10-16T09:05:24.193Z', 'rZ71T7+3PMCgkDsQ.kpAJxWwWGQdZcaknjnDg1A==.M/RvZTrYAu+Gi82yRcYxFis3JriId7+K+yb59S8gHnA4i97/Ug/6mgSojKYCohijVxbys4TTtK2oy1+SJrQhZpncxLDqRiiNH8AVDwmghlF3a9P0E8WfFsczT5BNKr8qf5aVyI10Rw==')
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, expires_at = EXCLUDED.expires_at;

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('56bdf6fd-6944-4b58-8afd-6bd8f9f14765', 'XANQMs4WU/QABkK2.PoNNrtYPOnuKTb2dJi6N6Q==.BMEYce8EsDlxeLBhH8zE6Fh6wIUg/YqfpfVE0Jq0gJg2sGM3Ne+o1zBFOkmHYwR4EPpuWVDDr3e2CHdcSAaBIxFyIT0tLPibMQeqxX7x9AOT/jx0lsfYrALbEm/wW8ZctLUDlxD2w2Ja9Ed1MJxmDRWVeME+uWSFjcj/yDjXyAMLcMHD3u1VP5CreKUAx/EDE2pv3W1zn+47trr5BR6ptu/e5ScDnrZqn/MpsPiMtvq/q/1Bb6q/dKcO4mChGiD4zNzB4dMMUyNFzSeN5w==', NULL, NULL)
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, expires_at = EXCLUDED.expires_at;

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('e343e8df-5168-4f40-879c-35dcbe2d186c', 'ogIQM7u+gXtuS4ar.Df1jsbm2c1mIAF+AeYK5xA==.cmACZhcHYnmCqHp/HH2bSr7cebzlQtdfNFH+2uQVcw/3S7UbgEaBrdsL2IQDo8cJ2CLhG5lYMQpbENbETtB89TPLazeAuLAxGjBRjxIHirRFgHTMQ2+UXibJlaWuIkHUuYpMDM/+e8/+QDAiO3KZwSFd3YUJP+W22z8WpvSqzgRB40MzH/xTqzfgKJ5Gbs89Kz2lQIf4b7MvCKq6By+zC7hzYb/yIh1K/57/YOVoq1neTRuC9g2OZTO81FqNjZUhqLJE7J7/0EXmyPBxCA==', NULL, NULL)
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, expires_at = EXCLUDED.expires_at;

INSERT INTO social_account_tokens (account_id, ciphertext, expires_at, refresh_ciphertext)
VALUES ('54dba928-27a0-4753-88ee-8fe5fc3e6c3e', 'ZBznvWtgAs6quJ0c.dhP8h1dwPgNqSajMvaBIkQ==.YJJXoWINuUDI9PcgU0oFKwJziXDDdH/2cEQrS45IxUrEOjFoeAbMGxEZ2smPxg==', NULL, NULL)
ON CONFLICT (account_id) DO UPDATE SET ciphertext = EXCLUDED.ciphertext, expires_at = EXCLUDED.expires_at;

