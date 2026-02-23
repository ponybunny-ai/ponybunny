# PonyBunny Agent Re-Design

本文档目的是对Agent的整个架构和运行体系做重新的设计，让PonyBunny成为真正的可配置的Agent Runner。

## 架构和功能陈述

1. 每个PonyBunny的runtime实例只加载并运行一个主Agent，默认是Lead。需要加载的main agent的名字在 `~/.config/ponybunny/ponybunny.json` 里增加一个配置项，如果没配置，则fallback到默认的lead agent。
2. 增加pb agent的命令集，用来列出系统内置的agent配置，选择哪个agent作为main agent运行（更新配置文件，然后触发重新加载或者重启scheduler），自定义agent（将系统的agent配置copy到 ~/.config/ponybunny/agents 下面，并可以通过手工编辑里面的内容来自定义Agent的行为），查看当前Agent的配置状态（diff user 和system）。
3. scheduler启动后，首先根据配置文件去寻找和加载Agent的配置，并在系统内创建Agent实例。 后续的scheduler的所有动作都由这个Agent实力做管理，要增加 human-in-loop 的能力。
4. 整体的运行流程如下描述： 
    1. Agent根据配置信息，可以自动化执行周期性的定时任务（cron task），也可以接受人类用户的指令来分析和执行特定要求的任务。 这两种执行任务的形态不冲突，可以同时存在。
    2. Scheduler会根据Agent的配置文件来加载所需要的skills，mcp，tools等内容，而不是一股脑儿的把系统内所有可以使用的资源全部加在进来。这样可以优化prompt的长度，也能让Agent的行为更加可控。
    3. 如果agent配置了可以启动subagent，那么要能自动启动subagent的能力。启动subagent的时候可以考虑使用spawn新的进程（带上parent agent id）的方式来实现，记得做兜底取消和关闭subagent任务的功能。
    4. 每个agent执行任务的时候，使用当前ponybunny已经实现的ReAct的循环，不要重新发明和实现新的代码。 当发现任务无法执行或获得期望结果的时候，将情况抛出来，并且附带上执行时的信息，作为后续改进优化ReAct核心引擎的依据。
    5. 加载Agent的时候可以加载人格化信息（通过加载 ~/.config/ponybunny/prompts/persona/ ） ,让后续人类跟Agent的对话过程更加有“人味”。 但这不是必须的。 可以在/Users/nickma/.config/ponybunny/ponybunny.json增加一个开关项来控制是否启用persona。
    6. 要实现Agent实例对运行的操作系统的权限的申请、使用、管理、取消等能力。
    7. 每个Agent可以有自己的work dir，就像公司的每个员工都有自己的工作目录一样。 

## 开发实现的基线

- /Users/nickma/Develop/nick-ma/pony/docs/agents/agent-config-runtime-assessment-2026-02-23.md

