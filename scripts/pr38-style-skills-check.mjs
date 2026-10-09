import assert from 'node:assert/strict'
import {
  STYLE_SKILLS,STYLE_SKILL_IDS,STYLE_SKILL_VERSION,
  normalizeStyleConfig,resolveStyleSkill,styleVisualTokens,
} from '../utils/comicStyleSkills.mjs'
import { renderTemplate } from '../utils/templateRenderer.mjs'

const expected=['anime','manga','superhero','cartoon','romance']
assert.deepEqual(STYLE_SKILL_IDS,expected)
assert.equal(STYLE_SKILL_VERSION,1)
assert.equal(STYLE_SKILLS.length,5)
for(const skill of STYLE_SKILLS) {
  assert.equal(skill.id,expected.find(id=>id===skill.id))
  assert.ok(skill.positive.length > 30 && skill.negative.length > 10)
  assert.equal(skill.palette.length,3)
  assert.equal(skill.negative.includes('speech bubbles'),true)
}
assert.equal(STYLE_SKILL_IDS.includes('realism'),false)
assert.equal(STYLE_SKILLS.some(s=>/realism|realistic/i.test(s.id+' '+s.label)),false)
const combo=normalizeStyleConfig({primary_style_id:'anime',secondary_style_id:'superhero',secondary_weight:30})
assert.deepEqual(combo,{primary_style_id:'anime',secondary_style_id:'superhero',secondary_weight:30,style_version:1})
assert.equal(resolveStyleSkill(combo).prompt.includes('70%'),true)
assert.equal(resolveStyleSkill(combo).prompt.includes('30%'),true)
assert.equal(resolveStyleSkill(combo).prompt.includes('no'),false) // normalized descriptions use 'No' capital; verify stable prompt structure
assert.notDeepEqual(styleVisualTokens(combo),styleVisualTokens({primary_style_id:'anime'}))
assert.deepEqual(normalizeStyleConfig({primary_style_id:'realism'}),normalizeStyleConfig({}))
assert.equal(normalizeStyleConfig({primary_style_id:'manga',secondary_style_id:'manga',secondary_weight:40}).secondary_style_id,null)
assert.equal(normalizeStyleConfig({primary_style_id:'cartoon',secondary_style_id:'manga',secondary_weight:999}).secondary_weight,90)

const legacy=renderTemplate({messageId:'msg-a',text:'Hello world'})
assert.equal(Object.hasOwn(legacy,'style'),false)
const styled=renderTemplate({
  messageId:'msg-a',senderId:'sender-a',text:'Hello world',
  styleConfig:combo,
})
const samePerson=renderTemplate({
  messageId:'msg-b',senderId:'sender-a',text:'Different words ✨',
  styleConfig:combo,
})
const otherPerson=renderTemplate({
  messageId:'msg-c',senderId:'sender-b',text:'Different person',
  styleConfig:combo,
})
assert.equal(styled.character.silhouette,samePerson.character.silhouette)
assert.equal(styled.text,'Hello world')
assert.equal(samePerson.text,'Different words ✨')
assert.deepEqual(styled.style,combo)
assert.deepEqual(styled.style,samePerson.style)
assert.equal(styled.state.key,'queued')
assert.ok(otherPerson.character.silhouette)
console.log('PR38 Style Skill registry/mixes, stable sender silhouettes, exact text and legacy golden compatibility PASS')
