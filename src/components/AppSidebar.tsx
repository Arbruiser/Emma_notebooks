import { Link, useRouterState } from "@tanstack/react-router";
import { BookMarked, ChevronRight } from "lucide-react";
import * as React from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { PageLink } from "@/components/PageLink";
import { buildNavTree, findPage, type NavNode } from "@/lib/content";

const logoLight = `${import.meta.env.BASE_URL}assets/lumi-logo-light.svg`;
const logoDark = `${import.meta.env.BASE_URL}assets/lumi-logo-dark.svg`;

function slugToHref(slug: string) {
  return slug === "" ? "/" : `/${slug}`;
}

/** On mobile the sidebar is a sheet overlay: close it after picking a page,
 * otherwise it stays open and hides the page that was just navigated to. */
function useCloseMobileNav() {
  const { isMobile, setOpenMobile } = useSidebar();
  return React.useCallback(() => {
    if (isMobile) setOpenMobile(false);
  }, [isMobile, setOpenMobile]);
}

/**
 * Top-level pages in runs that share a caption. A Jupyter Book's TOC splits
 * its chapters into captioned parts ("Materials", "Exercises"), and each part
 * gets its own sidebar group with that caption as its heading. Pages without a
 * caption (everything in a `content/` site) make one unlabelled group.
 */
function groupByCaption(tree: NavNode[]): { caption?: string; nodes: NavNode[] }[] {
  const groups: { caption?: string; nodes: NavNode[] }[] = [];
  for (const node of tree) {
    const last = groups[groups.length - 1];
    if (last && last.caption === node.page.caption) last.nodes.push(node);
    else groups.push({ caption: node.page.caption, nodes: [node] });
  }
  return groups;
}

export function AppSidebar() {
  const tree = React.useMemo(() => buildNavTree(), []);
  const groups = React.useMemo(() => groupByCaption(tree), [tree]);
  const glossary = React.useMemo(() => findPage("glossary"), []);
  const pathname = useRouterState({
    // Strip the trailing slash (trailingSlash: "always") so comparisons
    // against slug-derived hrefs like "/Chapter_2" keep matching.
    select: (s) => s.location.pathname.replace(/\/+$/, "") || "/",
  });
  const closeMobileNav = useCloseMobileNav();

  return (
    <Sidebar>
      <SidebarHeader className="h-14 flex-row items-center border-b border-sidebar-border px-3 py-0">
        <Link to="/" className="block w-full" onClick={closeMobileNav}>
          <img src={logoLight} alt="LUMI AI Factory" className="w-full h-auto block dark:hidden" />
          <img src={logoDark} alt="LUMI AI Factory" className="w-full h-auto hidden dark:block" />
        </Link>
      </SidebarHeader>
      <SidebarContent>
        {groups.map((group, i) => (
          <SidebarGroup key={`${i}-${group.caption ?? ""}`}>
            {group.caption && <SidebarGroupLabel>{group.caption}</SidebarGroupLabel>}
            <SidebarGroupContent>
              <SidebarMenu>
                {group.nodes.map((node) => (
                  <NavItem key={node.page.slug} node={node} pathname={pathname} />
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
      {glossary && (
        <SidebarFooter className="border-t border-sidebar-border">
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton
                asChild
                size="sm"
                isActive={pathname === "/glossary"}
                className="text-sidebar-foreground/70 data-[active=true]:text-sidebar-foreground"
              >
                <PageLink
                  slug="glossary"
                  draggable={false}
                  onClick={closeMobileNav}
                  aria-current={pathname === "/glossary" ? "page" : undefined}
                >
                  <BookMarked className="h-3.5 w-3.5" />
                  <span>{glossary.frontmatter.title}</span>
                </PageLink>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}

function isActiveTree(node: NavNode, pathname: string): boolean {
  if (slugToHref(node.page.slug) === pathname) return true;
  return node.children.some((c) => isActiveTree(c, pathname));
}

/**
 * Branch open state: collapsed by default, opened automatically whenever a
 * navigation lands inside the branch (sidebar click, in-content link,
 * prev/next), while still letting the reader collapse it by hand.
 */
function useBranchOpen(branchActive: boolean, pathname: string) {
  const [open, setOpen] = React.useState(branchActive);
  React.useEffect(() => {
    if (branchActive) setOpen(true);
  }, [branchActive, pathname]);
  return [open, setOpen] as const;
}

const wrapTitle =
  "h-auto min-h-8 py-1.5 [&>span:last-child]:whitespace-normal [&>span:last-child]:truncate-none";

/** Chevron that toggles a branch without navigating — the row's title is the
 * link to the parent page itself, so expand/collapse gets its own button. */
function BranchToggle({ open }: { open: boolean }) {
  return (
    <CollapsibleTrigger asChild>
      <SidebarMenuAction
        className="data-[state=open]:rotate-90"
        aria-label={open ? "Collapse section" : "Expand section"}
      >
        <ChevronRight />
      </SidebarMenuAction>
    </CollapsibleTrigger>
  );
}

function NavItem({ node, pathname }: { node: NavNode; pathname: string }) {
  const href = slugToHref(node.page.slug);
  const active = pathname === href;
  const branchActive = isActiveTree(node, pathname);
  const [open, setOpen] = useBranchOpen(branchActive, pathname);
  const closeMobileNav = useCloseMobileNav();

  if (node.children.length === 0) {
    return (
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} className={wrapTitle}>
          <PageLink
            slug={node.page.slug}
            draggable={false}
            onClick={closeMobileNav}
            aria-current={active ? "page" : undefined}
          >
            <span className="whitespace-normal leading-snug">{node.page.frontmatter.title}</span>
          </PageLink>
        </SidebarMenuButton>
      </SidebarMenuItem>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarMenuItem>
        <SidebarMenuButton asChild isActive={active} className={`${wrapTitle} pr-8`}>
          <PageLink
            slug={node.page.slug}
            draggable={false}
            onClick={closeMobileNav}
            aria-current={active ? "page" : undefined}
          >
            <span className="whitespace-normal leading-snug">{node.page.frontmatter.title}</span>
          </PageLink>
        </SidebarMenuButton>
        <BranchToggle open={open} />
        <CollapsibleContent>
          <NavSubTree node={node} pathname={pathname} />
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}

function NavSubTree({ node, pathname }: { node: NavNode; pathname: string }) {
  return (
    <SidebarMenuSub>
      {node.children.map((child) => (
        <NavSubItem key={child.page.slug} node={child} pathname={pathname} />
      ))}
    </SidebarMenuSub>
  );
}

function NavSubItem({ node, pathname }: { node: NavNode; pathname: string }) {
  const href = slugToHref(node.page.slug);
  const active = pathname === href;
  const branchActive = isActiveTree(node, pathname);
  const [open, setOpen] = useBranchOpen(branchActive, pathname);
  const closeMobileNav = useCloseMobileNav();

  if (node.children.length === 0) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton asChild isActive={active} className={wrapTitle}>
          <PageLink
            slug={node.page.slug}
            draggable={false}
            onClick={closeMobileNav}
            aria-current={active ? "page" : undefined}
          >
            <span className="whitespace-normal leading-snug">{node.page.frontmatter.title}</span>
          </PageLink>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <SidebarMenuSubItem className="relative">
        <SidebarMenuSubButton asChild isActive={active} className={`${wrapTitle} pr-8`}>
          <PageLink
            slug={node.page.slug}
            draggable={false}
            onClick={closeMobileNav}
            aria-current={active ? "page" : undefined}
          >
            <span className="whitespace-normal leading-snug">{node.page.frontmatter.title}</span>
          </PageLink>
        </SidebarMenuSubButton>
        <BranchToggle open={open} />
        <CollapsibleContent>
          <NavSubTree node={node} pathname={pathname} />
        </CollapsibleContent>
      </SidebarMenuSubItem>
    </Collapsible>
  );
}
