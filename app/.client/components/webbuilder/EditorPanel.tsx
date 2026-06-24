import { useStore } from '@nanostores/react';
import * as Tabs from '@radix-ui/react-tabs';
import { memo, useEffect, useState } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import { ErrorBoundary } from '~/.client/components/ErrorBoundary';
import { elementSelectionStore } from '~/.client/stores/element-selection';
import type { EditorPatch } from '~/.client/stores/pages';
import { logger, renderLogger } from '~/.client/utils/logger';
import type { PageHistory, Section } from '~/types/actions';
import type { DocumentProperties } from '~/types/editor';
import type { PageMap } from '~/types/pages';
import {
  EditorStudio,
  type OnChangeCallback,
  type OnLoadCallback,
  type OnReadyCallback,
  type OnSaveCallback,
} from '../editor/Editor';
import { ComponentLibraryPanel } from './ComponentLibraryPanel';
import { ElementInspectorPanel } from './ElementInspectorPanel';
import PageTree from './PageTree';

interface EditorPanelProps {
  documents?: Record<string, DocumentProperties>;
  currentPage?: string;
  currentSection?: Section;
  currentPatch?: EditorPatch;
  pages?: PageMap;
  unsavedPages?: Set<string>;
  pageHistory?: Record<string, PageHistory>;
  isStreaming?: boolean;
  onEditorChange?: OnChangeCallback;
  onPageSave?: OnSaveCallback;
  onPageSelect?: (pageName: string) => void;
  onPageReset?: () => void;
  onLoad?: OnLoadCallback;
  onReady?: OnReadyCallback;
  onPatchApplied?: (patchId: string) => void;
}

const editorSettings: any = { tabSize: 2 };

export const EditorPanel = memo(
  ({
    documents,
    pages,
    unsavedPages,
    currentPage,
    currentSection,
    currentPatch,
    isStreaming,
    onEditorChange,
    onPageSave,
    onPageSelect,
    onPageReset,
    onLoad,
    onReady,
    onPatchApplied,
  }: EditorPanelProps) => {
    renderLogger.trace('EditorPanel');
    // Tabs 受控：选中画布元素时自动切到「属性」，用户仍可手动切回。
    const [tab, setTab] = useState('pages');
    const sel = useStore(elementSelectionStore);
    useEffect(() => {
      if (sel.element) {
        setTab('inspector');
      }
    }, [sel.element]);
    return (
      <PanelGroup direction="vertical" className="h-full min-h-0">
        <Panel defaultSize={100} minSize={20} className="min-h-0">
          <PanelGroup direction="horizontal" className="h-full min-h-0">
            <Panel
              defaultSize={20}
              minSize={15}
              collapsible
              className="min-h-0 border-r border-upage-elements-borderColor"
            >
              <div className="h-full min-h-0">
                <Tabs.Root value={tab} onValueChange={setTab} className="flex h-full min-h-0 flex-col">
                  <Tabs.List className="flex shrink-0 border-b border-upage-elements-borderColor">
                    <Tabs.Trigger
                      value="pages"
                      className="flex-1 px-3 py-2 text-sm text-upage-elements-textSecondary data-[state=active]:text-upage-elements-textPrimary data-[state=active]:border-b-2 data-[state=active]:border-upage-elements-item-contentAccent focus-visible:outline-none"
                    >
                      页面
                    </Tabs.Trigger>
                    <Tabs.Trigger
                      value="components"
                      className="flex-1 px-3 py-2 text-sm text-upage-elements-textSecondary data-[state=active]:text-upage-elements-textPrimary data-[state=active]:border-b-2 data-[state=active]:border-upage-elements-item-contentAccent focus-visible:outline-none"
                    >
                      组件
                    </Tabs.Trigger>
                    <Tabs.Trigger
                      value="inspector"
                      className="flex-1 px-3 py-2 text-sm text-upage-elements-textSecondary data-[state=active]:text-upage-elements-textPrimary data-[state=active]:border-b-2 data-[state=active]:border-upage-elements-item-contentAccent focus-visible:outline-none"
                    >
                      属性
                    </Tabs.Trigger>
                  </Tabs.List>
                  <Tabs.Content value="pages" className="min-h-0 flex-grow overflow-auto focus-visible:outline-none">
                    <PageTree
                      className="h-full min-h-0"
                      pages={pages}
                      unsavedPages={unsavedPages}
                      selectedPage={currentPage}
                      onPageSelect={onPageSelect}
                    />
                  </Tabs.Content>
                  <Tabs.Content
                    value="components"
                    className="min-h-0 flex-grow overflow-auto focus-visible:outline-none"
                  >
                    <ComponentLibraryPanel className="h-full min-h-0" />
                  </Tabs.Content>
                  <Tabs.Content
                    value="inspector"
                    className="min-h-0 flex-grow overflow-auto focus-visible:outline-none"
                  >
                    <ElementInspectorPanel className="h-full min-h-0" />
                  </Tabs.Content>
                </Tabs.Root>
              </div>
            </Panel>

            <PanelResizeHandle />
            <Panel className="flex min-h-0 flex-col" defaultSize={80} minSize={20}>
              <div className="h-full min-h-0 flex-1 overflow-hidden">
                <ErrorBoundary
                  onError={(error) => {
                    const errorMessage = error instanceof Error ? error.message : '未知错误';
                    logger.error(`Editor 组件发生错误: ${errorMessage}`);
                  }}
                >
                  <EditorStudio
                    documents={documents}
                    editable={!isStreaming && currentPage !== undefined}
                    settings={editorSettings}
                    currentPage={currentPage}
                    currentSection={currentSection}
                    currentPatch={currentPatch}
                    onChange={onEditorChange}
                    onSave={onPageSave}
                    onReset={onPageReset}
                    onLoad={onLoad}
                    onReady={onReady}
                    onPatchApplied={onPatchApplied}
                  />
                </ErrorBoundary>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
      </PanelGroup>
    );
  },
);
