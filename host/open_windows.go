package main

import (
	"os/exec"
	"syscall"
)

// Opens a drawing in the program Windows has for its type (Reactio Draw for .reactio).
func openInProgram(file string) error {
	command := exec.Command("rundll32.exe", "url.dll,FileProtocolHandler", file)
	command.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
	return command.Start()
}
