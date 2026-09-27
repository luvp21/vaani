import { NavLink, Outlet, useLocation } from "react-router";
import { FolderKanban, Home, LogOut, Plus } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
} from "@/components/ui/sidebar";
import { Breadcrumb, BreadcrumbItem, BreadcrumbList, BreadcrumbPage } from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Logo } from "@/components/Logo";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/lib/auth";
import { allowanceText } from "@/lib/stage";

function pageTitle(pathname: string): string {
  if (pathname.startsWith("/app/studio")) return "Studio";
  return "Projects";
}

export function AppShell() {
  const { session, signOut } = useAuth();
  const { pathname } = useLocation();
  const inStudio = pathname.startsWith("/app/studio");

  return (
    <TooltipProvider>
      <SidebarProvider>
        <Sidebar collapsible="icon">
          <SidebarHeader className="h-14 justify-center border-b px-3">
            <NavLink to="/" aria-label="Vaani home">
              <Logo />
            </NavLink>
          </SidebarHeader>
          <SidebarContent>
            <SidebarGroup>
              <SidebarGroupLabel>Workspace</SidebarGroupLabel>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="Projects"
                      isActive={pathname === "/app"}
                      render={<NavLink to="/app" end />}
                    >
                      <FolderKanban />
                      <span>Projects</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      tooltip="New video"
                      isActive={inStudio}
                      render={<NavLink to="/app/studio" end />}
                    >
                      <Plus />
                      <span>New video</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </SidebarContent>
          <SidebarFooter className="border-t">
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton tooltip="Back to site" render={<NavLink to="/" />}>
                  <Home />
                  <span>Back to site</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
              <SidebarMenuItem>
                <SidebarMenuButton size="lg" className="pointer-events-none">
                  <Avatar className="size-7">
                    <AvatarFallback className="text-xs">{(session?.display_name ?? "V").slice(0, 1)}</AvatarFallback>
                  </Avatar>
                  <span className="flex min-w-0 flex-col text-left leading-tight">
                    <span className="truncate text-sm font-medium">{session?.display_name}</span>
                    <span className="text-xs text-muted-foreground">
                      {allowanceText(session)}
                    </span>
                  </span>
                  {session?.role === "judge" && (
                    <Badge variant="secondary" className="ml-auto">
                      Judge
                    </Badge>
                  )}
                </SidebarMenuButton>
              </SidebarMenuItem>
              {/* The judge gets in through a private link whose key is removed from the address bar, so
                  signing out by accident could lock them out. Only their session ends by expiry. */}
              {session?.role !== "judge" && (
                <SidebarMenuItem>
                  <SidebarMenuButton tooltip="Sign out" onClick={signOut}>
                    <LogOut />
                    <span>Sign out</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )}
            </SidebarMenu>
          </SidebarFooter>
          <SidebarRail />
        </Sidebar>

        <SidebarInset>
          <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b bg-background/85 px-4 backdrop-blur">
            <SidebarTrigger />
            <Separator orientation="vertical" className="h-5" />
            <Breadcrumb>
              <BreadcrumbList>
                <BreadcrumbItem>
                  <BreadcrumbPage>{pageTitle(pathname)}</BreadcrumbPage>
                </BreadcrumbItem>
              </BreadcrumbList>
            </Breadcrumb>
            <div className="ml-auto">
              {!inStudio && (
                <Button render={<NavLink to="/app/studio" />} size="sm">
                  <Plus data-icon="inline-start" />
                  New video
                </Button>
              )}
            </div>
          </header>
          <main className="mx-auto w-full max-w-[1600px] flex-1 px-4 py-6 sm:px-6 lg:py-8">
            <Outlet />
          </main>
        </SidebarInset>
      </SidebarProvider>
      <Toaster position="bottom-right" />
    </TooltipProvider>
  );
}
