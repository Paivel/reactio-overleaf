//go:build !darwin && !windows

package main

import (
	"os"
	"os/exec"
)

// Opens a drawing in the program the desktop has for its type; tests set
// REACTIO_OVERLEAF_OPEN to a command of their own.
func openInProgram(file string) error {
	command := os.Getenv("REACTIO_OVERLEAF_OPEN")
	if command == "" {
		command = "xdg-open"
	}
	return exec.Command(command, file).Start()
}
