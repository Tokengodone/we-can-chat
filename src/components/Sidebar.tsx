import { useState, useEffect, useRef, type ComponentType, type MouseEvent as ReactMouseEvent, type DragEvent as ReactDragEvent } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { MessageSquare, MessageSquareReply, BarChart3, Settings, Download, Aperture, UserCircle, Lock, LockOpen, ChevronUp, FolderClosed, Users, ArchiveRestore, Bot, Plus, MoreHorizontal, Pencil, Trash2, ChevronDown, Check, X, Pin, PinOff, GripVertical } from 'lucide-react'
import { useAppStore } from '../stores/appStore'
import * as configService from '../services/config'
import { onExportSessionStatus, requestExportSessionStatus } from '../services/exportBridge'

import './Sidebar.scss'

interface SidebarUserProfile {
  wxid: string
  displayName: string
  alias?: string
  avatarUrl?: string
}

const SIDEBAR_USER_PROFILE_CACHE_KEY = 'sidebar_user_profile_cache_v1'
const SIDEBAR_GROUPS_CACHE_KEY = 'sidebar_navigation_groups_v2'
const SIDEBAR_PINNED_ITEMS_CACHE_KEY = 'sidebar_navigation_pinned_v1'
const PINNED_NAV_GROUP_ID = 'pinned'
const ACCOUNT_PROFILES_CACHE_KEY = 'account_profiles_cache_v1'
const DEFAULT_DISPLAY_NAME = '微信用户'
const DEFAULT_SUBTITLE = '微信账号'

interface NavItemConfig {
  id: string
  label: string
  path: string
  icon: ComponentType<{ size?: number }>
  badge?: boolean
}

interface NavGroup {
  id: string
  name: string
  itemIds: string[]
  collapsed?: boolean
}

const NAV_ITEMS: NavItemConfig[] = [
  { id: 'chat', label: '聊天', path: '/chat', icon: MessageSquare },
  { id: 'sns', label: '朋友圈', path: '/sns', icon: Aperture },
  { id: 'bots', label: '机器人', path: '/bots', icon: Bot },
  { id: 'wechat-reply', label: '微信回复', path: '/wechat-reply', icon: MessageSquareReply },
  { id: 'contacts', label: '通讯录', path: '/contacts', icon: UserCircle },
  { id: 'resources', label: '资源库', path: '/resources', icon: FolderClosed },
  { id: 'analytics', label: '聊天分析', path: '/analytics', icon: BarChart3 },
  { id: 'export', label: '导出数据', path: '/export', icon: Download, badge: true },
  { id: 'backup', label: '数据库备份', path: '/backup', icon: ArchiveRestore }
]

const DEFAULT_NAV_GROUPS: NavGroup[] = [
  { id: 'recent', name: '最近使用', itemIds: ['analytics'] },
  { id: 'messages', name: '消息中心', itemIds: ['chat', 'contacts'] },
  { id: 'ai-tools', name: 'AI 工具', itemIds: ['bots', 'wechat-reply'] },
  { id: 'data', name: '数据管理', itemIds: ['resources', 'export', 'backup'] }
]

const readNavGroups = (): NavGroup[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIDEBAR_GROUPS_CACHE_KEY) || '')
    if (!Array.isArray(parsed) || !parsed.length) return DEFAULT_NAV_GROUPS
    const known = new Set(NAV_ITEMS.map(item => item.id))
    const groups = parsed.filter((group: NavGroup) => group && typeof group.id === 'string' && typeof group.name === 'string')
      .map((group: NavGroup) => ({ ...group, itemIds: Array.isArray(group.itemIds) ? group.itemIds.filter(id => known.has(id)) : [] }))
      // 删除首页后，清理旧版本只剩首页入口的默认“工作台”分组。
      .filter((group: NavGroup) => group.id !== 'workspace' || group.itemIds.length > 0)
    if (!groups.length) return DEFAULT_NAV_GROUPS
    const assigned = new Set(groups.flatMap(group => group.itemIds))
    groups[0].itemIds = [...groups[0].itemIds, ...NAV_ITEMS.map(item => item.id).filter(id => !assigned.has(id))]
    return groups
  } catch { return DEFAULT_NAV_GROUPS }
}

const readPinnedNavItems = (): string[] => {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(SIDEBAR_PINNED_ITEMS_CACHE_KEY) || '')
    const known = new Set(NAV_ITEMS.map(item => item.id))
    return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === 'string' && known.has(id)) : []
  } catch {
    return []
  }
}

interface SidebarUserProfileCache extends SidebarUserProfile {
  updatedAt: number
}

interface AccountProfilesCache {
  [wxid: string]: {
    displayName: string
    avatarUrl?: string
    alias?: string
    updatedAt: number
  }
}

const readSidebarUserProfileCache = (): SidebarUserProfile | null => {
  try {
    const raw = window.localStorage.getItem(SIDEBAR_USER_PROFILE_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as SidebarUserProfileCache
    if (!parsed || typeof parsed !== 'object') return null
    if (!parsed.wxid) return null
    return {
      wxid: parsed.wxid,
      displayName: typeof parsed.displayName === 'string' ? parsed.displayName : '',
      alias: parsed.alias,
      avatarUrl: parsed.avatarUrl
    }
  } catch {
    return null
  }
}

const writeSidebarUserProfileCache = (profile: SidebarUserProfile): void => {
  if (!profile.wxid) return
  try {
    const payload: SidebarUserProfileCache = {
      ...profile,
      updatedAt: Date.now()
    }
    window.localStorage.setItem(SIDEBAR_USER_PROFILE_CACHE_KEY, JSON.stringify(payload))

    // 同时写入账号缓存池
    const accountsCache = readAccountProfilesCache()
    accountsCache[profile.wxid] = {
      displayName: profile.displayName,
      avatarUrl: profile.avatarUrl,
      alias: profile.alias,
      updatedAt: Date.now()
    }
    window.localStorage.setItem(ACCOUNT_PROFILES_CACHE_KEY, JSON.stringify(accountsCache))
  } catch {
    // 忽略本地缓存失败，不影响主流程
  }
}

const readAccountProfilesCache = (): AccountProfilesCache => {
  try {
    const raw = window.localStorage.getItem(ACCOUNT_PROFILES_CACHE_KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed ? parsed : {}
  } catch {
    return {}
  }
}

const normalizeAccountId = (value?: string | null): string => {
  const trimmed = String(value || '').trim()
  if (!trimmed) return ''
  if (trimmed.toLowerCase().startsWith('wxid_')) {
    const match = trimmed.match(/^(wxid_[^_]+)/i)
    return match?.[1] || trimmed
  }
  const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
  return suffixMatch ? suffixMatch[1] : trimmed
}

interface SidebarProps {
  collapsed: boolean
}

function Sidebar({ collapsed }: SidebarProps) {
  const location = useLocation()
  const navigate = useNavigate()
  const [authEnabled, setAuthEnabled] = useState(false)
  const [activeExportTaskCount, setActiveExportTaskCount] = useState(0)
  const [navGroups, setNavGroups] = useState<NavGroup[]>(readNavGroups)
  const [pinnedItemIds, setPinnedItemIds] = useState<string[]>(readPinnedNavItems)
  const [navContextMenu, setNavContextMenu] = useState<{ itemId: string; x: number; y: number } | null>(null)
  const [isNavEditing, setIsNavEditing] = useState(false)
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({})
  const [draggedItemId, setDraggedItemId] = useState<string | null>(null)
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null)
  const [groupDropTarget, setGroupDropTarget] = useState<{ id: string; position: 'before' | 'after' } | null>(null)
  const [isAddingGroup, setIsAddingGroup] = useState(false)
  const [newGroupName, setNewGroupName] = useState('')
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null)
  const [editingGroupName, setEditingGroupName] = useState('')
  const [userProfile, setUserProfile] = useState<SidebarUserProfile>({
    wxid: '',
    displayName: DEFAULT_DISPLAY_NAME
  })
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountCardWrapRef = useRef<HTMLDivElement | null>(null)
  const setLocked = useAppStore(state => state.setLocked)

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_GROUPS_CACHE_KEY, JSON.stringify(navGroups))
  }, [navGroups])

  useEffect(() => {
    window.localStorage.setItem(SIDEBAR_PINNED_ITEMS_CACHE_KEY, JSON.stringify(pinnedItemIds))
  }, [pinnedItemIds])

  const addNavGroup = () => {
    setIsAddingGroup(true)
    setNewGroupName('')
  }

  const confirmAddNavGroup = () => {
    const name = newGroupName.trim()
    if (!name) return
    const id = `group-${Date.now()}`
    setNavGroups(prev => [...prev, { id, name, itemIds: [] }])
    // 新分组初始没有入口，普通浏览模式会隐藏空分组；创建后直接进入整理模式，
    // 同时展开新分组，让用户可以马上看到它并拖入导航项。
    setIsNavEditing(true)
    setOpenGroups(prev => ({ ...prev, [id]: true }))
    setIsAddingGroup(false)
    setNewGroupName('')
  }

  const startRenameNavGroup = (group: NavGroup) => {
    setEditingGroupId(group.id)
    setEditingGroupName(group.name)
  }

  const confirmRenameNavGroup = (group: NavGroup) => {
    const name = editingGroupName.trim()
    if (name && name !== group.name) {
      setNavGroups(prev => prev.map(item => item.id === group.id ? { ...item, name } : item))
    }
    setEditingGroupId(null)
    setEditingGroupName('')
  }

  const cancelRenameNavGroup = () => {
    setEditingGroupId(null)
    setEditingGroupName('')
  }

  const deleteNavGroup = (group: NavGroup) => {
    if (navGroups.length === 1) return
    const target = navGroups.find(item => item.id !== group.id)
    if (!target) return
    setNavGroups(prev => prev.filter(item => item.id !== group.id).map(item => item.id === target.id ? { ...item, itemIds: [...item.itemIds, ...group.itemIds] } : item))
  }

  const moveNavItem = (itemId: string, groupId: string) => {
    setNavGroups(prev => prev.map(group => group.id === groupId
      ? { ...group, itemIds: [...group.itemIds.filter(id => id !== itemId), itemId] }
      : { ...group, itemIds: group.itemIds.filter(id => id !== itemId) }))
  }

  const moveNavGroup = (groupId: string, targetGroupId: string, position: 'before' | 'after' = 'before') => {
    if (groupId === targetGroupId) return
    setNavGroups(prev => {
      const sourceIndex = prev.findIndex(group => group.id === groupId)
      const targetIndex = prev.findIndex(group => group.id === targetGroupId)
      if (sourceIndex < 0 || targetIndex < 0) return prev

      const next = [...prev]
      const [source] = next.splice(sourceIndex, 1)
      const adjustedTargetIndex = next.findIndex(group => group.id === targetGroupId)
      const insertIndex = adjustedTargetIndex + (position === 'after' ? 1 : 0)
      next.splice(insertIndex, 0, source)
      return next
    })
  }

  const handleGroupDragStart = (event: ReactDragEvent<HTMLElement>, groupId: string) => {
    event.stopPropagation()
    setDraggedGroupId(groupId)
    setGroupDropTarget(null)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', groupId)
  }

  const handleGroupDragOver = (event: ReactDragEvent<HTMLElement>, groupId: string) => {
    if (!draggedGroupId || draggedGroupId === groupId) return
    event.preventDefault()
    event.stopPropagation()
    event.dataTransfer.dropEffect = 'move'
    const bounds = event.currentTarget.getBoundingClientRect()
    setGroupDropTarget({ id: groupId, position: event.clientY < bounds.top + bounds.height / 2 ? 'before' : 'after' })
  }

  const handleGroupDrop = (event: ReactDragEvent<HTMLElement>, groupId: string) => {
    if (!draggedGroupId) return
    event.preventDefault()
    event.stopPropagation()
    moveNavGroup(draggedGroupId, groupId, groupDropTarget?.id === groupId ? groupDropTarget.position : 'before')
    setDraggedGroupId(null)
    setGroupDropTarget(null)
  }

  const handleGroupDragEnd = () => {
    setDraggedGroupId(null)
    setGroupDropTarget(null)
  }

  const togglePinNavItem = (itemId: string) => {
    setPinnedItemIds(prev => prev.includes(itemId) ? prev.filter(id => id !== itemId) : [...prev, itemId])
    setNavContextMenu(null)
  }

  const handleNavContextMenu = (event: ReactMouseEvent, itemId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const menuWidth = 164
    const menuHeight = 42
    setNavContextMenu({
      itemId,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - menuWidth - 8)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - menuHeight - 8))
    })
  }

  useEffect(() => {
    window.electronAPI.auth.verifyEnabled().then(setAuthEnabled)
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (!isAccountMenuOpen) return
      const target = event.target as Node | null
      if (accountCardWrapRef.current && target && !accountCardWrapRef.current.contains(target)) {
        setIsAccountMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [isAccountMenuOpen])

  useEffect(() => {
    if (!navContextMenu) return
    const closeMenu = () => setNavContextMenu(null)
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenu()
    }
    document.addEventListener('mousedown', closeMenu)
    document.addEventListener('keydown', handleKeyDown)
    window.addEventListener('resize', closeMenu)
    return () => {
      document.removeEventListener('mousedown', closeMenu)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('resize', closeMenu)
    }
  }, [navContextMenu])

  useEffect(() => {
    const unsubscribe = onExportSessionStatus((payload) => {
      const countFromPayload = typeof payload?.activeTaskCount === 'number'
        ? payload.activeTaskCount
        : Array.isArray(payload?.inProgressSessionIds)
          ? payload.inProgressSessionIds.length
          : 0
      const normalized = Math.max(0, Math.floor(countFromPayload))
      setActiveExportTaskCount(normalized)
    })

    requestExportSessionStatus()
    const timer = window.setTimeout(() => requestExportSessionStatus(), 120)

    return () => {
      unsubscribe()
      window.clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    let disposed = false
    let loadSeq = 0

    const loadCurrentUser = async () => {
      const seq = ++loadSeq
      const patchUserProfile = (patch: Partial<SidebarUserProfile>) => {
        if (disposed || seq !== loadSeq) return
        setUserProfile(prev => {
          const next: SidebarUserProfile = {
            ...prev,
            ...patch
          }
          if (typeof next.displayName !== 'string' || next.displayName.length === 0) {
            next.displayName = DEFAULT_DISPLAY_NAME
          }
          writeSidebarUserProfileCache(next)
          return next
        })
      }

      try {
        const wxid = await configService.getMyWxid()
        if (disposed || seq !== loadSeq) return
        const resolvedWxidRaw = String(wxid || '').trim()
        const cleanedWxid = normalizeAccountId(resolvedWxidRaw)
        const resolvedWxid = cleanedWxid || resolvedWxidRaw

        if (!resolvedWxidRaw && !resolvedWxid) {
          window.localStorage.removeItem(SIDEBAR_USER_PROFILE_CACHE_KEY)
          patchUserProfile({
            wxid: '',
            displayName: DEFAULT_DISPLAY_NAME,
            alias: undefined,
            avatarUrl: undefined
          })
          return
        }

        setUserProfile((prev) => {
          if (prev.wxid === resolvedWxid) return prev
          const seeded: SidebarUserProfile = {
            wxid: resolvedWxid,
            displayName: DEFAULT_DISPLAY_NAME,
            alias: undefined,
            avatarUrl: undefined
          }
          writeSidebarUserProfileCache(seeded)
          return seeded
        })

        const wxidCandidates = new Set<string>([
          resolvedWxidRaw.toLowerCase(),
          resolvedWxid.trim().toLowerCase(),
          cleanedWxid.trim().toLowerCase()
        ].filter(Boolean))

        const normalizeName = (value?: string | null): string | undefined => {
          if (typeof value !== 'string') return undefined
          if (value.length === 0) return undefined
          const lowered = value.trim().toLowerCase()
          if (lowered === 'self') return undefined
          if (lowered.startsWith('wxid_')) return undefined
          if (wxidCandidates.has(lowered)) return undefined
          return value
        }

        const pickFirstValidName = (...candidates: Array<string | null | undefined>): string | undefined => {
          for (const candidate of candidates) {
            const normalized = normalizeName(candidate)
            if (normalized) return normalized
          }
          return undefined
        }

        // 并行获取名称和头像
        const [contactResult, avatarResult] = await Promise.allSettled([
          (async () => {
            const candidates = Array.from(new Set([resolvedWxidRaw, resolvedWxid, cleanedWxid].filter(Boolean)))
            for (const candidate of candidates) {
              const contact = await window.electronAPI.chat.getContact(candidate)
              if (contact?.remark || contact?.nickName || contact?.alias) {
                return contact
              }
            }
            return null
          })(),
          window.electronAPI.chat.getMyAvatarUrl()
        ])
        if (disposed || seq !== loadSeq) return

        const myContact = contactResult.status === 'fulfilled' ? contactResult.value : null
        const displayName = pickFirstValidName(
          myContact?.remark,
          myContact?.nickName,
          myContact?.alias
        ) || DEFAULT_DISPLAY_NAME
        const alias = normalizeName(myContact?.alias)

        patchUserProfile({
          wxid: resolvedWxid,
          displayName,
          alias,
          avatarUrl: avatarResult.status === 'fulfilled' && avatarResult.value.success
            ? avatarResult.value.avatarUrl
            : undefined
        })
      } catch (error) {
        console.error('加载侧边栏用户信息失败:', error)
      }
    }

    const cachedProfile = readSidebarUserProfileCache()
    if (cachedProfile) {
      setUserProfile(cachedProfile)
    }

    void loadCurrentUser()
    const onWxidChanged = () => { void loadCurrentUser() }
    const onWindowFocus = () => { void loadCurrentUser() }
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void loadCurrentUser()
      }
    }
    window.addEventListener('wxid-changed', onWxidChanged as EventListener)
    window.addEventListener('focus', onWindowFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)
    return () => {
      disposed = true
      loadSeq += 1
      window.removeEventListener('wxid-changed', onWxidChanged as EventListener)
      window.removeEventListener('focus', onWindowFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  const getAvatarLetter = (name: string): string => {
    if (!name) return '微'
    const visible = name.trim()
    return (visible && [...visible][0]) || '微'
  }

  const openSettingsFromAccountMenu = () => {
    setIsAccountMenuOpen(false)
    navigate('/settings', {
      state: {
        backgroundLocation: location
      }
    })
  }

  const openAccountManagement = () => {
    setIsAccountMenuOpen(false)
    navigate('/account-management')
  }

  const isActive = (path: string) => {
    return location.pathname === path || location.pathname.startsWith(`${path}/`)
  }
  const exportTaskBadge = activeExportTaskCount > 99 ? '99+' : `${activeExportTaskCount}`
  const lockActionLabel = authEnabled ? '锁定应用' : '开启应用锁'

  const accountCard = (
    <div className="sidebar-user-card-wrap workspace-account-wrap" ref={accountCardWrapRef}>
      <div className={`sidebar-user-menu ${isAccountMenuOpen ? 'open' : ''}`} role="menu" aria-label="账号菜单">
        <button className="sidebar-user-menu-item" onClick={openAccountManagement} type="button" role="menuitem">
          <Users size={14} />
          <span>账号管理</span>
        </button>
        <button className="sidebar-user-menu-item" onClick={openSettingsFromAccountMenu} type="button" role="menuitem">
          <Settings size={14} />
          <span>设置</span>
        </button>
      </div>
      <div
        className={`sidebar-user-card ${isAccountMenuOpen ? 'menu-open' : ''}`}
        title={collapsed ? `${userProfile.displayName}${userProfile.alias ? `\n${userProfile.alias}` : ''}` : undefined}
        onClick={() => setIsAccountMenuOpen(prev => !prev)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            setIsAccountMenuOpen(prev => !prev)
          }
        }}
      >
        <div className="user-avatar">
          {userProfile.avatarUrl ? <img src={userProfile.avatarUrl} alt="" /> : <span>{getAvatarLetter(userProfile.displayName)}</span>}
        </div>
        <div className="user-meta">
          <div className="user-name">{userProfile.displayName || DEFAULT_DISPLAY_NAME}</div>
          <div className="user-wxid">{userProfile.alias || DEFAULT_SUBTITLE}</div>
        </div>
        {!collapsed && <span className={`user-menu-caret ${isAccountMenuOpen ? 'open' : ''}`}><ChevronUp size={14} /></span>}
      </div>
    </div>
  )

  return (
    <>
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
        <div className="workspace-header">
          {accountCard}
        </div>
        <div className="nav-organizer">
          <div className="nav-organizer-head">
            <span className="nav-organizer-title">工作区</span>
            {!collapsed && <div className="nav-organizer-head-actions">
              <button className="nav-organizer-add" onClick={addNavGroup} title="添加分组" aria-label="添加分组"><Plus size={15} /><span>新建分组</span></button>
              <button className={`nav-organizer-edit ${isNavEditing ? 'active' : ''}`} onClick={() => setIsNavEditing(prev => !prev)} title="整理导航" aria-label="整理导航">
                {isNavEditing ? <Check size={15} /> : <MoreHorizontal size={17} />}
              </button>
            </div>}
          </div>
          {isNavEditing && !collapsed && (
            <div className="nav-organizer-tools">
              <span>拖动入口到其他分组，也可以用右侧菜单调整归属</span>
              <button onClick={addNavGroup}><Plus size={14} /> 新建分组</button>
            </div>
          )}
          {isAddingGroup && !collapsed && (
            <div className="nav-add-group-form">
              <input autoFocus value={newGroupName} onChange={event => setNewGroupName(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') confirmAddNavGroup(); if (event.key === 'Escape') setIsAddingGroup(false) }} placeholder="分组名称" maxLength={20} />
              <button onClick={confirmAddNavGroup} disabled={!newGroupName.trim()} aria-label="确认添加分组"><Check size={14} /></button>
              <button onClick={() => setIsAddingGroup(false)} aria-label="取消添加分组"><X size={14} /></button>
            </div>
          )}
          <div className="nav-groups">
            {[
              ...(pinnedItemIds.length > 0 ? [{ id: PINNED_NAV_GROUP_ID, name: '置顶', itemIds: pinnedItemIds }] : []),
              ...navGroups
            ].map(group => {
              const isOpen = openGroups[group.id] !== false
              const isPinnedGroup = group.id === PINNED_NAV_GROUP_ID
              const groupItems = group.itemIds
                .filter(id => isPinnedGroup || !pinnedItemIds.includes(id))
                .map(id => NAV_ITEMS.find(item => item.id === id))
                .filter(Boolean) as NavItemConfig[]
              if (!isPinnedGroup && groupItems.length === 0 && !isNavEditing) return null
              const isGroupDropTarget = !isPinnedGroup && groupDropTarget?.id === group.id && draggedGroupId !== group.id
              return <section className={`nav-group ${isOpen ? 'open' : 'closed'} ${isPinnedGroup ? 'pinned-nav-group' : ''} ${draggedGroupId === group.id ? 'is-dragging' : ''} ${isGroupDropTarget ? `is-drop-target-${groupDropTarget?.position}` : ''}`} key={group.id}
                onDragOver={event => {
                  if (draggedGroupId && !isPinnedGroup) handleGroupDragOver(event, group.id)
                  else if (draggedItemId) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' }
                }}
                onDragLeave={event => {
                  if (draggedGroupId && !event.currentTarget.contains(event.relatedTarget as Node)) setGroupDropTarget(null)
                }}
                onDrop={event => {
                  if (draggedGroupId && !isPinnedGroup) {
                    handleGroupDrop(event, group.id)
                    return
                  }
                  if (draggedGroupId) {
                    event.preventDefault()
                    handleGroupDragEnd()
                    return
                  }
                  event.preventDefault()
                  if (!draggedItemId) return
                  if (isPinnedGroup) togglePinNavItem(draggedItemId)
                  else moveNavItem(draggedItemId, group.id)
                  setDraggedItemId(null)
                }}>
                {!collapsed && <div className="nav-group-head">
                  {isNavEditing && !isPinnedGroup && <span
                    className="nav-group-drag-handle"
                    draggable
                    role="button"
                    tabIndex={0}
                    aria-label={`\u62d6\u52a8${group.name}\u8c03\u6574\u5206\u7ec4\u987a\u5e8f`}
                    title="Drag to reorder groups"
                    onDragStart={event => handleGroupDragStart(event, group.id)}
                    onDragEnd={handleGroupDragEnd}
                    onKeyDown={event => {
                      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
                      event.preventDefault()
                      const index = navGroups.findIndex(item => item.id === group.id)
                      const target = navGroups[index + (event.key === 'ArrowUp' ? -1 : 1)]
                      if (target) moveNavGroup(group.id, target.id, event.key === 'ArrowUp' ? 'before' : 'after')
                    }}
                  ><GripVertical size={14} /></span>}
                  {editingGroupId === group.id ? (
                    <div className="nav-group-rename">
                      <ChevronDown size={13} aria-hidden="true" />
                      <input
                        autoFocus
                        value={editingGroupName}
                        maxLength={20}
                        aria-label="分组名称"
                        onFocus={event => event.currentTarget.select()}
                        onChange={event => setEditingGroupName(event.target.value)}
                        onBlur={() => confirmRenameNavGroup(group)}
                        onKeyDown={event => {
                          if (event.key === 'Enter') confirmRenameNavGroup(group)
                          if (event.key === 'Escape') cancelRenameNavGroup()
                        }}
                      />
                      <em>{groupItems.length}</em>
                    </div>
                  ) : (
                    <button className="nav-group-toggle" onClick={() => setOpenGroups(prev => ({ ...prev, [group.id]: !isOpen }))}>
                      {isPinnedGroup ? <Pin size={13} /> : <ChevronDown size={13} />}<span>{group.name}</span><em>{groupItems.length}</em>
                    </button>
                  )}
                  {isNavEditing && !isPinnedGroup && (
                    <div className="nav-group-actions">
                      {editingGroupId === group.id ? (
                        <>
                          <button
                            onMouseDown={event => event.preventDefault()}
                            onClick={() => confirmRenameNavGroup(group)}
                            aria-label="保存分组名称"
                            title="保存"
                            disabled={!editingGroupName.trim()}
                          ><Check size={13} /></button>
                          <button
                            onMouseDown={event => event.preventDefault()}
                            onClick={cancelRenameNavGroup}
                            aria-label="取消重命名"
                            title="取消"
                          ><X size={13} /></button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => startRenameNavGroup(group)} aria-label={`重命名${group.name}`} title="重命名"><Pencil size={13} /></button>
                          <button onClick={() => deleteNavGroup(group)} aria-label={`删除${group.name}`} title="删除分组" disabled={navGroups.length === 1}><Trash2 size={13} /></button>
                        </>
                      )}
                    </div>
                  )}
                </div>}
                {isOpen && groupItems.map(item => {
                  const Icon = item.icon
                  return <div className="nav-entry" key={item.id}
                    draggable={!collapsed}
                    onContextMenu={event => handleNavContextMenu(event, item.id)}
                    onDragStart={event => { setDraggedItemId(item.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id) }}
                    onDragEnd={() => setDraggedItemId(null)}>
                    <NavLink to={item.path} className={`nav-item ${isActive(item.path) ? 'active' : ''}`} title={collapsed ? item.label : undefined}>
                      <span className="nav-icon nav-icon-with-badge"><Icon size={20} />{collapsed && item.badge && activeExportTaskCount > 0 && <span className="nav-badge icon-badge">{exportTaskBadge}</span>}</span>
                      <span className="nav-label">{item.label}</span>
                      {!collapsed && item.badge && activeExportTaskCount > 0 && <span className="nav-badge">{exportTaskBadge}</span>}
                    </NavLink>
                    {isNavEditing && !collapsed && <select className="nav-move-select" value={group.id} onChange={event => moveNavItem(item.id, event.target.value)} aria-label={`将${item.label}移动到分组`}><option value={group.id}>{group.name}</option>{navGroups.filter(target => target.id !== group.id).map(target => <option key={target.id} value={target.id}>{target.name}</option>)}</select>}
                  </div>
                })}
              </section>
            })}
          </div>
        </div>
        <nav className="nav-menu legacy-nav-menu">
          {/* 聊天 */}
          <NavLink
            to="/chat"
            className={`nav-item ${isActive('/chat') ? 'active' : ''}`}
            title={collapsed ? '聊天' : undefined}
          >
            <span className="nav-icon"><MessageSquare size={20} /></span>
            <span className="nav-label">聊天</span>
          </NavLink>

          {/* 朋友圈 */}
          <NavLink
            to="/sns"
            className={`nav-item ${isActive('/sns') ? 'active' : ''}`}
            title={collapsed ? '朋友圈' : undefined}
          >
            <span className="nav-icon"><Aperture size={20} /></span>
            <span className="nav-label">朋友圈</span>
          </NavLink>

          {/* 机器人 */}
          <NavLink
            to="/bots"
            className={`nav-item ${isActive('/bots') ? 'active' : ''}`}
            title={collapsed ? '机器人' : undefined}
          >
            <span className="nav-icon"><Bot size={20} /></span>
            <span className="nav-label">机器人</span>
          </NavLink>

          {/* 通讯录 */}
          <NavLink
            to="/contacts"
            className={`nav-item ${isActive('/contacts') ? 'active' : ''}`}
            title={collapsed ? '通讯录' : undefined}
          >
            <span className="nav-icon"><UserCircle size={20} /></span>
            <span className="nav-label">通讯录</span>
          </NavLink>

          {/* 资源浏览 */}
          <NavLink
            to="/resources"
            className={`nav-item ${isActive('/resources') ? 'active' : ''}`}
            title={collapsed ? '资源浏览' : undefined}
          >
            <span className="nav-icon"><FolderClosed size={20} /></span>
            <span className="nav-label">资源浏览</span>
          </NavLink>

          {/* 聊天分析 */}
          <NavLink
            to="/analytics"
            className={`nav-item ${isActive('/analytics') ? 'active' : ''}`}
            title={collapsed ? '聊天分析' : undefined}
          >
            <span className="nav-icon"><BarChart3 size={20} /></span>
            <span className="nav-label">聊天分析</span>
          </NavLink>

          {/* 导出 */}
          <NavLink
            to="/export"
            className={`nav-item ${isActive('/export') ? 'active' : ''}`}
            title={collapsed ? '导出' : undefined}
          >
            <span className="nav-icon nav-icon-with-badge">
              <Download size={20} />
              {collapsed && activeExportTaskCount > 0 && (
                <span className="nav-badge icon-badge">{exportTaskBadge}</span>
              )}
            </span>
            <span className="nav-label">导出</span>
            {!collapsed && activeExportTaskCount > 0 && (
              <span className="nav-badge">{exportTaskBadge}</span>
            )}
          </NavLink>



          <NavLink
            to="/backup"
            className={`nav-item ${isActive('/backup') ? 'active' : ''}`}
            title={collapsed ? '数据库备份' : undefined}
          >
            <span className="nav-icon"><ArchiveRestore size={20} /></span>
            <span className="nav-label">数据库备份</span>
          </NavLink>


        </nav>

        <div className="sidebar-footer">
          <button
            className="nav-item sidebar-lock-action"
            onClick={() => {
              if (authEnabled) {
                setLocked(true)
                return
              }
              navigate('/settings', {
                state: {
                  initialTab: 'security',
                  backgroundLocation: location
                }
              })
            }}
            title={collapsed ? lockActionLabel : undefined}
            aria-label={lockActionLabel}
          >
            <span className="nav-icon">{authEnabled ? <Lock size={20} /> : <LockOpen size={20} />}</span>
            <span className="nav-label">{lockActionLabel}</span>
          </button>

        </div>
        {navContextMenu && (
          <div
            className="sidebar-context-menu"
            role="menu"
            style={{ left: navContextMenu.x, top: navContextMenu.y }}
            onMouseDown={event => event.stopPropagation()}
          >
            <button type="button" role="menuitem" onClick={() => togglePinNavItem(navContextMenu.itemId)}>
              {pinnedItemIds.includes(navContextMenu.itemId) ? <PinOff size={15} /> : <Pin size={15} />}
              <span>{pinnedItemIds.includes(navContextMenu.itemId) ? '取消置顶' : '置顶到顶部'}</span>
            </button>
          </div>
        )}
      </aside>
    </>
  )
}

export default Sidebar
