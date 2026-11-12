// reactio-overleaf-host: the helper the browser extension talks to (Chrome
// native messaging). It puts a figure's drawing from an Overleaf project in a
// folder on this computer, opens it in Reactio Draw, and sends back the files
// Reactio Draw writes beside it on each save (the drawing, its .pdf and .tex),
// for the extension to upload to the project.
//
// Messages are JSON, each preceded by its length (4 bytes, this machine's
// byte order, which is little-endian on every platform Chrome runs on).
package main

import (
	"bufio"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
	"time"
)

const version = "0.3.0"

// Chrome refuses a message from the host over 1 MB; file data goes in chunks well under it.
const chunkBytes = 600 * 1024

// The most one file may be, as in the extension.
const maxFileBytes = 64 * 1024 * 1024

// How often the folders are looked at, and how long a file must stay unchanged before it is sent.
const pollEvery = 700 * time.Millisecond
const settleFor = 1200 * time.Millisecond

var drawingExtensions = map[string]bool{"reactio": true, "cdxml": true, "cdx": true, "drawio": true, "dio": true, "ipe": true, "excalidraw": true, "ggb": true, "odg": true}
var outputExtensions = map[string]bool{"tex": true, "pdf": true, "pdf_tex": true, "png": true, "jpg": true, "svg": true, "eps": true}

var plainName = regexp.MustCompile(`^[A-Za-z0-9 ._-]{1,150}$`)
var projectID = regexp.MustCompile(`^[0-9a-f]{24}$`)

type message struct {
	Op      string `json:"op"`
	ID      string `json:"id,omitempty"`
	Project string `json:"project,omitempty"`
	Dir     string `json:"dir,omitempty"`
	Name    string `json:"name,omitempty"`
	Data    string `json:"data,omitempty"`
	// The figure's files beside the drawing (its .tex and .pdf): Reactio Draw
	// writes them again on each save only when the .tex there names the drawing.
	Outputs []struct {
		Name string `json:"name"`
		Data string `json:"data"`
	} `json:"outputs,omitempty"`
}

type out map[string]any

var writeLock sync.Mutex

func send(value out) {
	body, err := json.Marshal(value)
	if err != nil {
		return
	}
	writeLock.Lock()
	defer writeLock.Unlock()
	var size [4]byte
	binary.LittleEndian.PutUint32(size[:], uint32(len(body)))
	os.Stdout.Write(size[:])
	os.Stdout.Write(body)
}

func read(in *bufio.Reader) (*message, error) {
	var size [4]byte
	if _, err := io.ReadFull(in, size[:]); err != nil {
		return nil, err
	}
	length := binary.LittleEndian.Uint32(size[:])
	if length > 100*1024*1024 {
		return nil, errors.New("message too large")
	}
	body := make([]byte, length)
	if _, err := io.ReadFull(in, body); err != nil {
		return nil, err
	}
	var msg message
	if err := json.Unmarshal(body, &msg); err != nil {
		return nil, err
	}
	return &msg, nil
}

func extensionOf(name string) string {
	dot := strings.LastIndex(name, ".")
	if dot <= 0 {
		return ""
	}
	return strings.ToLower(name[dot+1:])
}

// A folder path inside a project: plain names joined by "/", nothing that climbs out.
func cleanDir(dir string) (string, error) {
	dir = strings.Trim(dir, "/")
	if dir == "" {
		return "", nil
	}
	for _, part := range strings.Split(dir, "/") {
		if part == "." || part == ".." || !plainName.MatchString(part) {
			return "", errors.New("the figure's folder is not a plain folder of the project")
		}
	}
	return dir, nil
}

// Where figures of Overleaf projects are kept on this computer.
func workRoot() (string, error) {
	if dir := os.Getenv("REACTIO_OVERLEAF_DIR"); dir != "" {
		return dir, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, "Reactio Overleaf"), nil
}

type seen struct {
	size    int64
	modTime time.Time
	changed time.Time // when a change was first noticed; zero once sent
}

// A folder being watched: the project and folder its files go back to.
type watched struct {
	project string
	dir     string
	files   map[string]*seen
}

var (
	watchLock sync.Mutex
	watches   = map[string]*watched{} // by local folder
)

func snapshot(folder string) map[string]os.FileInfo {
	result := map[string]os.FileInfo{}
	entries, err := os.ReadDir(folder)
	if err != nil {
		return result
	}
	for _, entry := range entries {
		name := entry.Name()
		ext := extensionOf(name)
		if !entry.Type().IsRegular() || !plainName.MatchString(name) || !(drawingExtensions[ext] || outputExtensions[ext]) {
			continue
		}
		if info, err := entry.Info(); err == nil {
			result[name] = info
		}
	}
	return result
}

func open(msg *message) error {
	if !projectID.MatchString(msg.Project) {
		return errors.New("not an Overleaf project id")
	}
	dir, err := cleanDir(msg.Dir)
	if err != nil {
		return err
	}
	if !plainName.MatchString(msg.Name) || msg.Name == "." || msg.Name == ".." || !drawingExtensions[extensionOf(msg.Name)] {
		return errors.New("only drawings (.reactio and the like) open in their program")
	}
	data, err := base64.StdEncoding.DecodeString(msg.Data)
	if err != nil || len(data) > maxFileBytes {
		return errors.New("could not read the drawing sent")
	}
	root, err := workRoot()
	if err != nil {
		return err
	}
	folder := filepath.Join(root, msg.Project, filepath.FromSlash(dir))
	if err := os.MkdirAll(folder, 0o755); err != nil {
		return err
	}
	file := filepath.Join(folder, msg.Name)
	if info, err := os.Lstat(file); err == nil && !info.Mode().IsRegular() {
		return errors.New("something other than a file is where the drawing goes")
	}
	// The project's copies win: they are what the document was built with.
	if err := writeIfChanged(file, data); err != nil {
		return err
	}
	for _, output := range msg.Outputs {
		if !plainName.MatchString(output.Name) || output.Name == "." || output.Name == ".." || !outputExtensions[extensionOf(output.Name)] {
			return errors.New("the figure carries a file type that is not a figure's")
		}
		bytes, err := base64.StdEncoding.DecodeString(output.Data)
		if err != nil || len(bytes) > maxFileBytes {
			return errors.New("could not read the figure's files sent")
		}
		if err := writeIfChanged(filepath.Join(folder, output.Name), bytes); err != nil {
			return err
		}
	}
	watchLock.Lock()
	w := watches[folder]
	if w == nil {
		w = &watched{project: msg.Project, dir: dir, files: map[string]*seen{}}
		watches[folder] = w
	}
	// What is there now is the starting point: only later saves are sent.
	for name, info := range snapshot(folder) {
		w.files[name] = &seen{size: info.Size(), modTime: info.ModTime()}
	}
	watchLock.Unlock()
	return openInProgram(file)
}

// Writes a regular file unless it already holds `data`; never through a link.
func writeIfChanged(file string, data []byte) error {
	if info, err := os.Lstat(file); err == nil && !info.Mode().IsRegular() {
		return errors.New("something other than a file is where " + filepath.Base(file) + " goes")
	}
	if current, err := os.ReadFile(file); err == nil && string(current) == string(data) {
		return nil
	}
	return os.WriteFile(file, data, 0o644)
}

// Sends one file in chunks; the extension puts them together.
func sendFile(project, dir, name string, data []byte) {
	encoded := base64.StdEncoding.EncodeToString(data)
	id := fmt.Sprintf("%d", time.Now().UnixNano())
	total := (len(encoded) + chunkBytes - 1) / chunkBytes
	if total == 0 {
		total = 1
	}
	for index := 0; index < total; index++ {
		end := (index + 1) * chunkBytes
		if end > len(encoded) {
			end = len(encoded)
		}
		send(out{"op": "chunk", "id": id, "index": index, "total": total, "data": encoded[index*chunkBytes : end]})
	}
	path := name
	if dir != "" {
		path = dir + "/" + name
	}
	send(out{"op": "changed", "id": id, "project": project, "path": path})
}

// Order of sending: the drawing and pictures first, the .tex that includes them last.
func sendOrder(ext string) int {
	switch {
	case drawingExtensions[ext]:
		return 0
	case ext == "tex":
		return 2
	default:
		return 1
	}
}

func poll() {
	for {
		time.Sleep(pollEvery)
		type pending struct {
			project, dir, folder, name string
		}
		var ready []pending
		watchLock.Lock()
		now := time.Now()
		for folder, w := range watches {
			for name, info := range snapshot(folder) {
				last := w.files[name]
				if last == nil {
					w.files[name] = &seen{size: info.Size(), modTime: info.ModTime(), changed: now}
					continue
				}
				if info.Size() != last.size || !info.ModTime().Equal(last.modTime) {
					last.size, last.modTime, last.changed = info.Size(), info.ModTime(), now
					continue
				}
				if !last.changed.IsZero() && now.Sub(last.changed) >= settleFor {
					last.changed = time.Time{}
					ready = append(ready, pending{w.project, w.dir, folder, name})
				}
			}
		}
		watchLock.Unlock()
		sort.SliceStable(ready, func(a, b int) bool {
			return sendOrder(extensionOf(ready[a].name)) < sendOrder(extensionOf(ready[b].name))
		})
		for _, file := range ready {
			data, err := os.ReadFile(filepath.Join(file.folder, file.name))
			if err != nil || len(data) > maxFileBytes {
				continue
			}
			sendFile(file.project, file.dir, file.name, data)
		}
	}
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--version" || os.Args[1] == "-V") {
		fmt.Println("reactio-overleaf-host", version)
		return
	}
	go poll()
	in := bufio.NewReaderSize(os.Stdin, 1<<20)
	for {
		msg, err := read(in)
		if err != nil {
			// Chrome closed the connection: nothing more to send to.
			return
		}
		switch msg.Op {
		case "hello":
			send(out{"op": "hello", "id": msg.ID, "version": version})
		case "open":
			if err := open(msg); err != nil {
				send(out{"op": "error", "id": msg.ID, "message": err.Error()})
			} else {
				send(out{"op": "opened", "id": msg.ID})
			}
		default:
			send(out{"op": "error", "id": msg.ID, "message": "unknown request " + msg.Op})
		}
	}
}
