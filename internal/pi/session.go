// Package pi wraps a `pi --mode rpc` subprocess, exposing its JSONL command
// (stdin) and event (stdout) streams as Go channels.
package pi

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/exec"
	"strings"
	"sync"
)

// Session is a running `pi --mode rpc` process. Events are fanned out to any
// number of subscribers so multiple WebSockets can observe one process.
type Session struct {
	cmd   *exec.Cmd
	stdin io.WriteCloser

	mu     sync.Mutex
	closed bool
	subs   map[chan []byte]struct{}
}

// Options configures a pi session.
type Options struct {
	Bin       string   // path to pi binary (default "pi")
	Args      []string // extra args (e.g. --no-session, --name foo)
	ConfigDir string   // sets PI_CODING_AGENT_DIR if non-empty
	Dir       string   // working directory for pi
}

// Start launches a pi RPC subprocess.
func Start(ctx context.Context, opts Options) (*Session, error) {
	bin := opts.Bin
	if bin == "" {
		bin = "pi"
	}

	args := append([]string{"--mode", "rpc"}, opts.Args...)
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Dir = opts.Dir
	cmd.Env = os.Environ()
	if opts.ConfigDir != "" {
		cmd.Env = append(cmd.Env, "PI_CODING_AGENT_DIR="+opts.ConfigDir)
	}

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, fmt.Errorf("stdin pipe: %w", err)
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, fmt.Errorf("stdout pipe: %w", err)
	}
	cmd.Stderr = os.Stderr

	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start pi: %w", err)
	}

	s := &Session{
		cmd:   cmd,
		stdin: stdin,
		subs:  make(map[chan []byte]struct{}),
	}
	go s.readEvents(stdout)
	return s, nil
}

// Subscribe returns a channel of raw event lines and an unsubscribe func. The
// channel is closed when the session exits or the subscriber unsubscribes.
// Slow subscribers drop events rather than blocking the reader.
func (s *Session) Subscribe() (<-chan []byte, func()) {
	ch := make(chan []byte, 256)
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		close(ch)
		return ch, func() {}
	}
	s.subs[ch] = struct{}{}
	s.mu.Unlock()

	var once sync.Once
	return ch, func() {
		once.Do(func() {
			s.mu.Lock()
			if _, ok := s.subs[ch]; ok {
				delete(s.subs, ch)
				close(ch)
			}
			s.mu.Unlock()
		})
	}
}

// readEvents parses pi's stdout as strict LF-delimited JSONL and fans each line
// out to all subscribers. On exit, all subscriber channels are closed.
func (s *Session) readEvents(stdout io.Reader) {
	defer s.closeSubs()

	r := bufio.NewReader(stdout)
	for {
		line, err := r.ReadBytes('\n')
		if len(line) > 0 {
			// strip trailing \n and optional \r
			line = trimLine(line)
			if len(line) > 0 {
				buf := make([]byte, len(line))
				copy(buf, line)
				s.broadcast(buf)
			}
		}
		if err != nil {
			if err != io.EOF {
				slog.Error("pi stdout read error", "err", err)
			}
			return
		}
	}
}

// broadcast sends a line to every subscriber, dropping it for any subscriber
// whose buffer is full (slow consumers must not stall the reader).
func (s *Session) broadcast(line []byte) {
	s.mu.Lock()
	for ch := range s.subs {
		select {
		case ch <- line:
		default:
		}
	}
	s.mu.Unlock()
}

// closeSubs closes all subscriber channels and marks the session closed.
func (s *Session) closeSubs() {
	s.mu.Lock()
	s.closed = true
	for ch := range s.subs {
		close(ch)
		delete(s.subs, ch)
	}
	s.mu.Unlock()
}

func trimLine(b []byte) []byte {
	s := strings.TrimRight(string(b), "\n")
	s = strings.TrimRight(s, "\r")
	return []byte(s)
}

// Send writes a raw JSON command line to pi's stdin.
func (s *Session) Send(cmd []byte) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("session closed")
	}
	if _, err := s.stdin.Write(cmd); err != nil {
		return err
	}
	_, err := s.stdin.Write([]byte("\n"))
	return err
}

// Close terminates the pi subprocess.
func (s *Session) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	for ch := range s.subs {
		close(ch)
		delete(s.subs, ch)
	}
	s.mu.Unlock()

	_ = s.stdin.Close()
	if s.cmd.Process != nil {
		_ = s.cmd.Process.Kill()
	}
	return s.cmd.Wait()
}
