// Package sessions lists pi session files for the resume/switch UI. The pi RPC
// protocol has no "list sessions" command, so we read the session directory
// directly and derive names from each file's session_info entries.
package sessions

import (
	"bufio"
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Info summarises one session file.
type Info struct {
	Path     string    `json:"path"`
	Name     string    `json:"name"`
	Modified time.Time `json:"modified"`
	Preview  string    `json:"preview"` // first user message
}

// List returns sessions in a directory, newest first.
func List(dir string) ([]Info, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []Info{}, nil
		}
		return nil, err
	}

	var out []Info
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".jsonl") {
			continue
		}
		path := filepath.Join(dir, e.Name())
		fi, err := e.Info()
		if err != nil {
			continue
		}
		info := Info{Path: path, Modified: fi.ModTime()}
		scan(path, &info)
		if info.Name == "" {
			info.Name = info.Preview
		}
		if info.Name == "" {
			info.Name = strings.TrimSuffix(e.Name(), ".jsonl")
		}
		out = append(out, info)
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Modified.After(out[j].Modified) })
	return out, nil
}

// scan reads a session file for its latest name and first user message.
func scan(path string, info *Info) {
	f, err := os.Open(path)
	if err != nil {
		return
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	for sc.Scan() {
		var rec struct {
			Type    string `json:"type"`
			Name    string `json:"name"`
			Message struct {
				Role    string          `json:"role"`
				Content json.RawMessage `json:"content"`
			} `json:"message"`
		}
		if json.Unmarshal(sc.Bytes(), &rec) != nil {
			continue
		}
		switch rec.Type {
		case "session_info":
			if rec.Name != "" {
				info.Name = rec.Name // last one wins (renames)
			}
		case "message":
			if info.Preview == "" && rec.Message.Role == "user" {
				info.Preview = firstText(rec.Message.Content)
			}
		}
	}
}

// firstText extracts a short preview from a message content (string or blocks).
func firstText(raw json.RawMessage) string {
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return clip(s)
	}
	var blocks []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	}
	if json.Unmarshal(raw, &blocks) == nil {
		for _, b := range blocks {
			if b.Type == "text" && b.Text != "" {
				return clip(b.Text)
			}
		}
	}
	return ""
}

func clip(s string) string {
	s = strings.TrimSpace(strings.ReplaceAll(s, "\n", " "))
	if len(s) > 80 {
		return s[:80] + "…"
	}
	return s
}
