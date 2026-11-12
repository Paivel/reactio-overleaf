package main

import "os/exec"

// Opens a drawing in Reactio Draw, or else the program macOS has for its type.
func openInProgram(file string) error {
	if exec.Command("open", "-a", "Reactio Draw", file).Run() == nil {
		return nil
	}
	return exec.Command("open", file).Run()
}
