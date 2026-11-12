#!/bin/bash
# Stands in for Reactio Draw. As it does, a save writes the figure's .pdf and .tex again
# only when a .tex beside the drawing names it on its first line.
file="$1"; dir="$(dirname "$file")"; stem="$(basename "$file" .reactio)"
echo "opened $file" >> "$dir/../../opened.log"
( sleep 2
  printf '{"drawing":"saved"}' > "$file"
  if head -1 "$dir/$stem.tex" 2>/dev/null | grep -qx "% editable-figure source: $stem.reactio"; then
    printf '%%PDF saved' > "$dir/$stem.pdf"
    printf '%% editable-figure source: %s.reactio\n\\node{\\rcmpd{new}};\n' "$stem" > "$dir/$stem.tex"
  fi ) &
