    async def run_interactive_mode(self):
        """Run the main interactive loop"""
        self.display_welcome_screen()
        
        # Main interactive loop
        while True:
            try:
                # Get user input
                user_input = await self.async_prompt("You › ")
                
                if not user_input.strip():
                    continue
                
                # Check for commands (starting with /)
                if user_input.startswith('/'):
                    parts = user_input.split()
                    cmd = parts[0].lower()
                    args = parts[1:]
                    
                    # Handle commands
                    if cmd in ['/exit', '/quit']:
                        self.console.print("[bold bright_cyan]👋 Goodbye![/bold bright_cyan]")
                        break
                    elif cmd == '/help':
                        self.display_help()
                    elif cmd == '/clear':
                        self.console.clear()
                    elif cmd == '/add':
                        await self.handle_add_file(args)
                    elif cmd == '/add-ro':
                        await self.handle_add_file(args, read_only=True)
                    elif cmd == '/remove':
                        await self.handle_remove_file(args)
                    elif cmd == '/files':
                        self.display_files()
                    elif cmd == '/clear-files':
                        self.added_files.clear()
                        self.read_only_files.clear()
                        self.console.print("[bold green]✓[/bold green] [dim]│[/dim] [bright_white]Cleared all files from context[/bright_white]")
                    elif cmd == '/mcp-list':
                        if self.mcp_server_names:
                            self.console.print("\n[bold bright_cyan]🔌 Connected MCP Servers[/bold bright_cyan]\n")
                            for server in self.mcp_server_names:
                                self.console.print(f"  [bold green]•[/bold green] [bold cyan]{server}[/bold cyan]")
                            self.console.print()
                        else:
                            self.console.print("[yellow]⚠ No MCP servers connected[/yellow]")
                    elif cmd == '/mcp-tools':
                        server_name = args[0] if args else None
                        if server_name:
                            tools = await self.list_mcp_tools(server_name)
                            if tools:
                                table = Table(
                                    title=f"🔧 Available Tools - {server_name}",
                                    border_style="bright_cyan",
                                    box=ROUNDED,
                                    show_header=True,
                                    header_style="bold bright_white"
                                )
                                table.add_column("Tool Name", style="bold cyan", no_wrap=False)
                                table.add_column("Description", style="bright_white", no_wrap=False)
                                for tool in tools:
                                    table.add_row(
                                        tool.get('name', 'Unknown'),
                                        tool.get('description', 'No description')
                                    )
                                self.console.print("")
                                self.console.print(table)
                                self.console.print()
                            else:
                                self.console.print(f"[yellow]⚠ No tools available from {server_name}[/yellow]")
                        else:
                            # Show tools from all servers
                            tools = await self.list_mcp_tools()
                            if tools:
                                table = Table(
                                    title="🔧 All Available Tools",
                                    border_style="bright_cyan",
                                    box=ROUNDED,
                                    show_header=True,
                                    header_style="bold bright_white"
                                )
                                table.add_column("Tool Name", style="bold cyan", no_wrap=False)
                                table.add_column("Description", style="bright_white", no_wrap=False)
                                for tool in tools:
                                    table.add_row(
                                        tool.get('name', 'Unknown'),
                                        tool.get('description', 'No description')
                                    )
                                self.console.print("")
                                self.console.print(table)
                                self.console.print()
                            else:
                                self.console.print("[yellow]⚠ No tools available[/yellow]")
                    elif cmd == '/mcp-call':
                        if len(args) < 2:
                            self.console.print("[red]Usage: /mcp-call <server> <tool> [args][/red]")
                            continue
                        server = args[0]
                        tool = args[1]
                        tool_args = {}
                        if len(args) > 2:
                            try:
                                tool_args = json.loads(" ".join(args[2:]))
                            except json.JSONDecodeError:
                                self.console.print("[red]Tool arguments must be valid JSON[/red]")
                                continue
                        try:
                            result = await self.call_mcp_tool(server, tool, tool_args)
                            self.console.print(Panel(
                                json.dumps(result, indent=2),
                                title=f"Tool Result: {tool}"
                            ))
                        except Exception as e:
                            self.console.print(f"[red]Error: {e}[/red]")
                    elif cmd == '/models':
                        models = await self.get_ollama_models()
                        if models:
                            self.console.print("\n[bold bright_cyan]🤖 Available Ollama Models[/bold bright_cyan]\n")
                            current_model = self.config.openai.model if self.config else "unknown"
                            for i, model in enumerate(models, 1):
                                if model == current_model:
                                    self.console.print(f"  [bold green]✓[/bold green] [bold cyan]{model}[/bold cyan] [dim](current)[/dim]")
                                else:
                                    self.console.print(f"  [dim]{i}.[/dim] [cyan]{model}[/cyan]")
                            self.console.print()
                        else:
                            self.console.print("[yellow]⚠ No models available or could not connect to Ollama[/yellow]")
                    elif cmd == '/switch-model':
                        if not args:
                            self.console.print("[red]Usage: /switch-model <model_name>[/red]")
                            models = await self.get_ollama_models()
                            if models:
                                self.console.print("[cyan]Available models:[/cyan]")
                                for model in models:
                                    self.console.print(f"  - {model}")
                            else:
                                self.console.print("[yellow]Could not fetch models[/yellow]")
                            continue
                        model_name = " ".join(args)
                        success = await self.switch_model(model_name)
                        if success:
                            self.console.print(f"[bold green]✓ Switched[/bold green] [dim]│[/dim] [bright_white]Now using:[/bright_white] [bold cyan]{model_name}[/bold cyan]")
                    elif cmd == '/stream':
                        self.streaming_enabled = not self.streaming_enabled
                        status = "enabled" if self.streaming_enabled else "disabled"
                        icon = "🌊" if self.streaming_enabled else "📄"
                        self.console.print(f"[bold green]✓ Streaming {status}[/bold green] [dim]│[/dim] {icon} [bright_white]Responses will be {status}[/bright_white]")
                    elif cmd == '/export-tools':
                        self.console.print("[cyan]Fetching tools from MCP servers...[/cyan]")
                        raw_tools = await self.list_mcp_tools()
                        self.console.print(f"\n[cyan]All servers:[/cyan]")
                        self.console.print(f"  Raw tools count: {len(raw_tools)}")
                        if raw_tools:
                            try:
                                sample_json = json.dumps(raw_tools[:1], indent=2)
                                self.console.print(Panel(
                                    Syntax(sample_json, "json", theme="monokai", line_numbers=True),
                                    title="Sample Tools",
                                    border_style="cyan"
                                ))
                            except Exception as e:
                                self.console.print(f"[yellow]Could not serialize tools: {e}[/yellow]")
                        
                        tools = await self.build_tools_list()
                        self.console.print(f"\n[cyan]Formatted tools for OpenAI:[/cyan]")
                        try:
                            tools_json = json.dumps(tools, indent=2)
                            self.console.print(Panel(
                                Syntax(tools_json, "json", theme="monokai", line_numbers=True),
                                title="Available Tools (JSON)",
                                border_style="cyan"
                            ))
                        except Exception as e:
                            self.console.print(f"[red]Error serializing tools: {e}[/red]")
                    else:
                        self.console.print(f"[bold red]✗ Unknown command:[/bold red] [yellow]{cmd}[/yellow]")
                        self.console.print("[dim]Type [bold]/help[/bold] to see all available commands[/dim]")
                else:
                    # Natural conversation (not a command)
                    # Only show spinner if streaming is disabled (streaming has its own live display)
                    if not self.streaming_enabled:
                        with Progress(
                            SpinnerColumn("dots", style="cyan"),
                            TextColumn("[bold bright_cyan]Thinking...[/bold bright_cyan]"),
                            console=self.console,
                            transient=True
                        ) as progress:
                            progress.add_task("", total=None)
                            try:
                                response = await self.chat_with_ai(user_input, show_tool_details=True)
                            except Exception as e:
                                self.console.print(f"[bold red]✗ Error[/bold red] [dim]│[/dim] {e}")
                                continue
                    else:
                        try:
                            response = await self.chat_with_ai(user_input, show_tool_details=True)
                        except Exception as e:
                            self.console.print(f"[bold red]✗ Error[/bold red] [dim]│[/dim] {e}")
                            continue
                    
                    # Display AI response with premium styling (streaming handles its own panel)
                    if not self.streaming_enabled:
                        self.console.print()
                        response_panel = Panel(
                            Markdown(response),
                            title="[bold bright_white]🤖 A-Coder[/bold bright_white]",
                            border_style="bright_green",
                            box=ROUNDED,
                            padding=(1, 2)
                        )
                        self.console.print(response_panel)
                        self.console.print()
                    else:
                        # Streaming already displayed the response in a live panel
                        pass
            
            except KeyboardInterrupt:
                self.console.print("\n[yellow]Use '/exit' or '/quit' to leave[/yellow]")
            except Exception as e:
                self.console.print(f"[red]Error: {e}[/red]")
                import traceback
                traceback.print_exc()