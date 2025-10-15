<template>
  <div class="app">
    <div class="sidebar">
      <div class="card">
        <h3>1) Upload PDF Template</h3>
        <input type="file" accept="application/pdf" @change="onUpload" />
        <div v-if="templates.length" style="margin-top:8px">
          <label>Pick Template:</label>
          <select v-model="selectedTemplateId">
            <option v-for="t in templates" :key="t.id" :value="t.id">
              {{ t.id }} - {{ t.original_filename }} ({{ t.pages }}p)
            </option>
          </select>
        </div>
      </div>

      <div class="card">
        <h3>2) Data Fields</h3>
        <div class="list">
          <div v-for="dp in datapoints" :key="dp.id" class="field-pill"
               draggable="true"
               @dragstart="(e)=>onDragStart(e, dp)">
            {{ dp.label }}
          </div>
        </div>
      </div>

      <div class="card">
        <h3>3) Companies</h3>
        <div>
          <label><input type="checkbox" v-model="allCompanies" @change="toggleAllCompanies"> Select All</label>
        </div>
        <div v-for="c in companies" :key="c.id">
          <label><input type="checkbox" v-model="selectedCompanies" :value="c.id"> {{ c.name }}</label>
        </div>
      </div>

      <div class="card">
        <h3>4) Actions</h3>
        <button @click="saveMappings" :disabled="!selectedTemplateId">Save Mappings</button>
        <button @click="generate" :disabled="!selectedTemplateId || selectedCompanies.length===0">Generate PDFs (ZIP)</button>
      </div>
    </div>

    <div class="content">
      <div class="toolbar">
        <label>Page:
          <input type="number" min="1" :max="currentPageCount" v-model.number="currentPage" />
          / {{ currentPageCount }}
        </label>
        <span v-if="selectedTemplateId">Template #{{selectedTemplateId}}</span>
      </div>

      <div v-if="pdfImageUrl" class="pdf-stage" @dragover.prevent @drop="onDrop">
        <img :src="pdfImageUrl" ref="pdfImg" @load="syncPositions" style="display:block; max-width:100%; height:auto; border:1px solid #ddd; border-radius:6px;" />
        <div v-for="(m,idx) in pageMappings" :key="idx"
             class="drop-field"
             :style="styleFor(m)"
             @mousedown="startMove($event, m)">
          {{ labelFor(m.datapoint_id) }}
        </div>
      </div>
      <p v-else>Upload a PDF template to begin. Drag fields from the left and drop them onto the preview to place them.</p>
    </div>
  </div>
</template>

<script setup>
import { ref, reactive, computed, onMounted } from 'vue'
import axios from 'axios'
import * as pdfjsLib from 'pdfjs-dist'

import pdfjsWorker from "pdfjs-dist/build/pdf.worker.mjs?url";
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;
const API = (import.meta.env.VITE_API_BASE || 'http://localhost:8080')

const companies = ref([])
const datapoints = ref([])
const templates = ref([])
const selectedTemplateId = ref(null)

const mappings = ref([]) // [{datapoint_id, page, x, y, font_size}]
const currentPage = ref(1)
const currentPageCount = ref(1)

const pdfImageUrl = ref(null)
const pdfImg = ref(null)

const selectedCompanies = ref([])
const allCompanies = ref(false)

const labelFor = (dpid)=> datapoints.value.find(d=>d.id===dpid)?.label || dpid
const pageMappings = computed(()=> mappings.value.filter(m=>m.page===currentPage.value))

const styleFor = (m)=>{
  const img = pdfImg.value
  if (!img) return {}
  const rect = img.getBoundingClientRect()
  const x = rect.left + m.x * rect.width
  const y = rect.top + m.y * rect.height
  return { left: `${m.x*rect.width}px`, top: `${m.y*rect.height}px` }
}

let dragPayload = null
function onDragStart(e, dp){
  dragPayload = { datapoint_id: dp.id }
}
function onDrop(e){
  if (!dragPayload) return
  const img = pdfImg.value
  const rect = img.getBoundingClientRect()
  const x = (e.clientX - rect.left)/rect.width
  const y = (e.clientY - rect.top)/rect.height
  mappings.value.push({ datapoint_id: dragPayload.datapoint_id, page: currentPage.value, x, y, font_size: 12 })
  dragPayload = null
}

let moving = null
function startMove(e, m){
  e.preventDefault()
  const img = pdfImg.value
  const rect = img.getBoundingClientRect()
  moving = { m, dx: e.clientX - m.x*rect.width, dy: e.clientY - m.y*rect.height }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', endMove)
}
function onMove(e){
  if (!moving) return
  const img = pdfImg.value
  const rect = img.getBoundingClientRect()
  moving.m.x = Math.min(0.99, Math.max(0.01, (e.clientX - moving.dx)/rect.width))
  moving.m.y = Math.min(0.99, Math.max(0.01, (e.clientY - moving.dy)/rect.height))
}
function endMove(){
  window.removeEventListener('mousemove', onMove)
  window.removeEventListener('mouseup', endMove)
  moving = null
}
function syncPositions(){ /* noop - ensures computed positions after image load */ }

async function onUpload(ev){
  const f = ev.target.files[0]
  if (!f) return
  const fd = new FormData()
  fd.append('file', f)
  const { data } = await axios.post(`${API}/api/templates/upload`, fd, { headers: { 'Content-Type':'multipart/form-data' }})
  templates.value.unshift(data)
  selectedTemplateId.value = data.id
  await loadTemplatePreview()
}

async function loadTemplatePreview(){
  if (!selectedTemplateId.value) return
  // fetch template list to get stored path count
  const t = templates.value.find(t=>t.id===selectedTemplateId.value)
  currentPageCount.value = t?.pages || 1

  // fetch the binary for first page as image via pdf.js
  // we'll request the file via backend static /storage using stored_path
  // but we don't expose stored path in FE; create fetch to /api/templates to get latest path
  const list = (await axios.get(`${API}/api/templates`)).data
  const tpl = list.find(x=>x.id===selectedTemplateId.value)
  if (!tpl) return
  const url = `${API}/storage/uploads/${tpl.stored_path.split('/').pop()}`

  const loadingTask = pdfjsLib.getDocument(url)
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(currentPage.value)
  const viewport = page.getViewport({ scale: 1.5 })
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  canvas.width = viewport.width
  canvas.height = viewport.height
  await page.render({ canvasContext: ctx, viewport }).promise
  pdfImageUrl.value = canvas.toDataURL()

  // load existing mappings
  const map = (await axios.get(`${API}/api/templates/${selectedTemplateId.value}/mappings`)).data
  mappings.value = map.map(m=>({ ...m, x:Number(m.x), y:Number(m.y), font_size:Number(m.font_size) }))
}

async function saveMappings(){
  await axios.post(`${API}/api/templates/${selectedTemplateId.value}/mappings`, { mappings: mappings.value })
  alert("Mappings saved!")
}

async function generate(){
  const res = await axios.post(`${API}/api/templates/${selectedTemplateId.value}/generate`, { companyIds: selectedCompanies.value }, { responseType: 'blob' })
  const blob = new Blob([res.data], { type: 'application/zip' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `generated_${selectedTemplateId.value}.zip`
  a.click()
  URL.revokeObjectURL(url)
}

function toggleAllCompanies(){
  if (allCompanies.value) selectedCompanies.value = companies.value.map(c=>c.id)
  else selectedCompanies.value = []
}

onMounted(async ()=>{
  companies.value = (await axios.get(`${API}/api/companies`)).data
  datapoints.value = (await axios.get(`${API}/api/datapoints`)).data
  templates.value = (await axios.get(`${API}/api/templates`)).data
  if (templates.value.length){
    selectedTemplateId.value = templates.value[0].id
    await loadTemplatePreview()
  }
})
</script>
