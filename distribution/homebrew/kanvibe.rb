cask "kanvibe" do
  version "1.0.0"
  sha256 "759c8d56debc2915b2691ab60e7ffb68422d5f7bc1accc3f704fcc11ddaab237"

  url "https://github.com/rookedsysc/kanvibe/releases/download/v#{version}/KanVibe-#{version}.dmg"
  name "KanVibe"
  desc "AI agent task management Kanban board"
  homepage "https://github.com/rookedsysc/kanvibe"

  app "KanVibe.app"

  zap trash: [
    "~/Library/Application Support/KanVibe",
    "~/Library/Preferences/com.kanvibe.desktop.plist",
  ]
end
