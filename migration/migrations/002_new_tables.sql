CREATE TABLE IF NOT EXISTS child_progress (
  child_id TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  xp INTEGER DEFAULT 0,
  level TEXT DEFAULT 'Beginner' CHECK (level IN ('Beginner', 'Intermediate', 'Advanced')),
  streak INTEGER DEFAULT 0,
  last_practice_date DATE,
  completed_words TEXT[] DEFAULT '{}',
  total_attempts INTEGER DEFAULT 0,
  achievements JSONB DEFAULT '[]',
  badges JSONB DEFAULT '[]',
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS word_of_day_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  child_id TEXT REFERENCES children(id) ON DELETE CASCADE,
  word TEXT NOT NULL,
  date DATE NOT NULL,
  correct BOOLEAN,
  attempts INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  UNIQUE (child_id, date)
);

CREATE TABLE IF NOT EXISTS teacher_messages (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  teacher_id TEXT REFERENCES users(id),
  parent_id TEXT REFERENCES users(id),
  child_id TEXT REFERENCES children(id),
  message TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  read BOOLEAN DEFAULT false,
  type TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS child_credentials (
  child_id TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  username TEXT UNIQUE NOT NULL,
  hashed_password TEXT NOT NULL,
  plain_password TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

ALTER TABLE child_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE word_of_day_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE teacher_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_credentials ENABLE ROW LEVEL SECURITY;

CREATE POLICY "parents_read_child_progress" ON child_progress
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM children
      WHERE children.id = child_progress.child_id
      AND children.parent_id = auth.uid()::text
    )
    OR EXISTS (
      SELECT 1 FROM children
      WHERE children.id = child_progress.child_id
      AND children.auth_uid = auth.uid()::text
    )
  );

CREATE POLICY "students_manage_own_child_progress" ON child_progress
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM children
      WHERE children.id = child_progress.child_id
      AND children.auth_uid = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM children
      WHERE children.id = child_progress.child_id
      AND children.auth_uid = auth.uid()::text
    )
  );

CREATE POLICY "parents_students_read_word_log" ON word_of_day_log
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM children
      WHERE children.id = word_of_day_log.child_id
      AND (children.parent_id = auth.uid()::text OR children.auth_uid = auth.uid()::text)
    )
  );

CREATE POLICY "students_manage_own_word_log" ON word_of_day_log
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM children
      WHERE children.id = word_of_day_log.child_id
      AND children.auth_uid = auth.uid()::text
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM children
      WHERE children.id = word_of_day_log.child_id
      AND children.auth_uid = auth.uid()::text
    )
  );

CREATE POLICY "parents_read_messages" ON teacher_messages
  FOR SELECT USING (parent_id = auth.uid()::text);

CREATE POLICY "parents_update_messages" ON teacher_messages
  FOR UPDATE USING (parent_id = auth.uid()::text)
  WITH CHECK (parent_id = auth.uid()::text);

CREATE POLICY "teachers_insert_messages" ON teacher_messages
  FOR INSERT WITH CHECK (teacher_id = auth.uid()::text);

CREATE POLICY "users_read_notifications" ON notifications
  FOR SELECT USING (user_id = auth.uid()::text);

CREATE POLICY "users_update_notifications" ON notifications
  FOR UPDATE USING (user_id = auth.uid()::text)
  WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "users_insert_own_notifications" ON notifications
  FOR INSERT WITH CHECK (user_id = auth.uid()::text);

CREATE POLICY "parents_read_child_credentials" ON child_credentials
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM children
      WHERE children.id = child_credentials.child_id
      AND children.parent_id = auth.uid()::text
    )
  );
